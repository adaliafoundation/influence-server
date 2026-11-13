const { expect } = require('chai');
const mongoose = require('mongoose');
const { Entity, Lot, Claim } = require('@influenceth/sdk');
const { decodeComponent } = require('@common/lib/prospecting');
const handlers = require('@common/lib/events/handlers/starknet/Dispatcher');
const { ElasticSearchService, EntityService, CrewmateService, CrewService,
  ResolvableEventNotificationService } = require('@common/services');

const uuid = Entity.packEntity({ label: 7, id: 99 });
describe('Prospecting game indexing', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'Starknet', 'ClaimComponent']);
  });

  it('decodes genuine Claim metadata without losing 64-bit campaign IDs', function () {
    const metadata = decodeComponent('Claim', { data: ['1', uuid, '1', '12000', '500000', '18446744073709551615'] });
    expect(metadata).to.deep.equal({ entity: { label: 7, id: 99 },
      rulesVersion: 1,
      rateBps: 12000,
      referenceAbundancePpm: 500000,
      campaignId: '18446744073709551615' });
    expect(Claim.fromEntity({ label: 7,
      id: 99,
      Deposit: { resource: 1, initialYield: 1000000, remainingYield: 500000, status: 3 },
      Location: { location: { label: 4, id: Lot.toId(1, 1) } },
      Claim: metadata }).kind).to.equal('prospected');
  });

  for (const [version, improving] of [[0, false], [1, false], [1, true]]) {
    it(`resolves an existing V${version} legacy ${improving ? 'improvement' : 'sample'} through its original finish event`, async function () {
      this._sandbox.stub(EntityService, 'getEntity').resolves(null);
      this._sandbox.stub(CrewmateService, 'findByCrew').resolves([]);
      this._sandbox.stub(CrewService, 'findStation').resolves(null);
      this._sandbox.stub(ResolvableEventNotificationService, 'createOrUpdate').resolves();
      const base = { blockNumber: 10, blockHash: '0x123', transactionIndex: 1,
        logIndex: 1, transactionHash: '0xabc', timestamp: 100 };
      const Start = version ? handlers.SamplingDepositStartedV1 : handlers.SamplingDepositStarted;
      const location = ['7', '99', '4', String(Lot.toId(1, 1)), '1'];
      const details = version ? [String(Number(improving)), '5', '3', '2'] : [];
      const start = await mongoose.model('Starknet').create(Start.parseEvent({ ...base,
        data: [...location, ...details, '200', '9', '9', '0x123'] }));
      await new Start(start).processEvent();
      const activity = await mongoose.model('Activity').findOne({ 'event.event': Start.eventConfig.name });
      expect(activity.unresolvedFor).to.have.lengthOf(1);
      const Finish = handlers.SamplingDepositFinished;
      const finish = await mongoose.model('Starknet').create(Finish.parseEvent({ ...base,
        logIndex: 2, timestamp: 300, data: ['7', '99', '1000000', '9', '9', '0x123'] }));
      await new Finish(finish).processEvent();
      expect((await mongoose.model('Activity').findById(activity._id)).unresolvedFor).to.equal(null);
      expect(await mongoose.model('ClaimComponent').countDocuments()).to.equal(0);
    });
  }

  it('keeps campaign IDs separate from entities and preserves the full metadata and entropy', function () {
    const core = decodeComponent('ProspectingCore', { data: ['2', '18446744073709551615', '2', '123', '1',
      (2n ** 80n + 1n).toString(), '3', (2n ** 63n).toString(), '100', '200'] });
    expect(core.campaignId).to.equal('18446744073709551615');
    expect(core).not.to.have.property('entity');
    expect(core.commitment).to.equal((2n ** 128n + 123n).toString());
    expect(core.meta).to.equal((2n ** 80n + 1n).toString());
    expect(core.randomness).to.equal((2n ** 63n).toString());
    expect(() => decodeComponent('ProspectingCore', { data: ['1', '1'] })).to.throw();
  });

  it('uses the historical extraction activity name for V1 baseline and claim jobs', function () {
    const Handler = handlers.ResourceExtractionStartedV1;
    const parsed = Handler.parseEvent({ data: ['0', '0', '0', '1', '1000', '5', '1', '2', '5', '3', '2', '10000',
      '2500', '500000', '1', '9', '0x123'] });
    expect(parsed.event).to.equal('ResourceExtractionStartedV1');
    expect(parsed.name).to.equal('ResourceExtractionStarted');
    expect(parsed.returnValues.deposit).to.equal(null);
    expect(parsed.returnValues).to.include({ mode: 0, rateBps: 2500, referenceAbundancePpm: 500000 });
    expect(parsed.returnValues.extractor).to.deep.equal({ label: 5, id: 1 });
  });

  it('creates a baseline activity and resolves it through the existing collection handler', async function () {
    this._sandbox.stub(EntityService, 'getEntity').resolves(null);
    this._sandbox.stub(CrewmateService, 'findByCrew').resolves([]);
    this._sandbox.stub(CrewService, 'findStation').resolves(null);
    this._sandbox.stub(ResolvableEventNotificationService, 'createOrUpdate').resolves();
    const base = { blockNumber: 10,
      blockHash: '0x123',
      transactionIndex: 1,
      logIndex: 1,
      transactionHash: '0xabc',
      timestamp: 1000 };
    const Start = handlers.ResourceExtractionStartedV1;
    const start = await mongoose.model('Starknet').create(Start.parseEvent({ ...base,
      data: ['0', '0', '0', '1', '1000', '5', '1', '2', '5', '3', '2', '10000',
        '2500', '500000', '1', '9', '0x123'] }));
    await new Start(start).processEvent();
    let activity = await mongoose.model('Activity').findOne({ 'event.event': 'ResourceExtractionStartedV1' });
    expect(activity.unresolvedFor).to.have.lengthOf(1);
    expect(activity.entities.every((entity) => entity.label !== 7)).to.equal(true);
    const Finish = handlers.ResourceExtractionFinished;
    const finish = await mongoose.model('Starknet').create(Finish.parseEvent({ ...base,
      logIndex: 2,
      timestamp: 1001,
      data: ['5', '1', '2', '1', '1000', '5', '3', '2', '1', '9', '0x123'] }));
    await new Finish(finish).processEvent();
    activity = await mongoose.model('Activity').findById(activity._id);
    expect(activity.unresolvedFor).to.equal(null);
    await this.utils.resetCollections(['Activity', 'Entity', 'Starknet']);
  });

  it('persists companion metadata and rejects older event replays', async function () {
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    const Handler = handlers.ComponentUpdatedClaim;
    const base = { data: ['1', uuid, '1', '12000', '500000', '7'],
      blockNumber: 10,
      blockHash: '0x123',
      transactionIndex: 1,
      logIndex: 1,
      transactionHash: '0xabc',
      timestamp: 1000 };
    const event = await mongoose.model('Starknet').create(Handler.parseEvent(base));
    await new Handler(event).processEvent();
    const old = await mongoose.model('Starknet').create(Handler.parseEvent({ ...base,
      data: ['1', uuid, '1', '9000', '500000', '7'],
      blockNumber: 9,
      timestamp: 999,
      transactionHash: '0xdef' }));
    await new Handler(old).processEvent();
    const claim = await mongoose.model('ClaimComponent').findOne({ 'entity.uuid': uuid }).lean();
    expect(claim.rateBps).to.equal(12000);
    expect(claim.campaignId).to.equal('7');
    await mongoose.model('ClaimComponent').deleteMany({});
    await mongoose.model('Starknet').deleteMany({ transactionHash: { $in: ['0xabc', '0xdef'] } });
  });
});
