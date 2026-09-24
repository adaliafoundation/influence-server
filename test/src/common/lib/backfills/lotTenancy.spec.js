const { expect } = require('chai');
const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Unique');
const LotTenancyBackfill = require('@common/lib/backfills/lotTenancy');

const dispatcher = Address.toStandard('0x123', 'starknet');
const lot = Entity.lotFromIndex(1, 1);
const tenant = Entity.Crew(2);
const rawEvent = (blockNumber, value, logIndex = 0) => ({
  address: dispatcher,
  blockNumber,
  blockHash: `0x${blockNumber.toString(16)}`,
  transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
  transactionIndex: 0,
  logIndex,
  timestamp: 1000 + blockNumber,
  status: 'ACCEPTED_ON_L1',
  keys: Handler.eventConfig.keys,
  data: ['0x2', '0x5573654c6f74', lot.uuid, value]
});

describe('Lot tenancy backfill', function () {
  let backfill;
  let provider;

  beforeEach(function () {
    provider = {
      getBlock: this._sandbox.stub().resolves({ blockNumber: 12, blockHash: '0xc', status: 'ACCEPTED_ON_L1' }),
      getEvents: this._sandbox.stub().resolves([])
    };
    backfill = new LotTenancyBackfill({
      provider, addresses: [dispatcher], dispatcher, originBlock: 10, log: () => {}
    });
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(async function () {
    await backfill.jobs.deleteMany({});
    await backfill.lots.deleteMany({});
    await this.utils.resetCollections(['UseLotComponent', 'Event', 'Entity']);
  });

  it('stages only latest tenancy, retains zero, and applies without pending historical events', async function () {
    const unrelated = { ...rawEvent(10, tenant.uuid), keys: ['0x1'] };
    const occupancy = { ...rawEvent(10, tenant.uuid), data: ['0x2', '0x4c6f74557365', lot.uuid, tenant.uuid] };
    provider.getEvents.resolves([rawEvent(12, '0x0'), unrelated, occupancy, rawEvent(10, tenant.uuid)]);
    const status = await backfill.scan({ job: 'test' });
    expect(status).to.include({ lots: 1, cleared: 1, assigned: 0, phase: 'ready' });
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(0);
    expect(await mongoose.model('Starknet').countDocuments()).to.equal(0);
    const result = await backfill.apply({ job: 'test', processorStopped: true });
    expect(result).to.include({ phase: 'complete', applied: 1 });
    expect((await mongoose.model('UseLotComponent').findOne()).tenant).to.equal(null);
    expect((await mongoose.model('Starknet').findOne()).lastProcessed).to.be.instanceOf(Date);
    expect(ElasticSearchService.queueEntityForIndexing.calledOnce).to.equal(true);
  });

  it('resumes scan at the first unfinished batch and rejects changed bounds', async function () {
    provider.getEvents.onCall(0).resolves([rawEvent(10, tenant.uuid)]);
    provider.getEvents.onCall(1).rejects(new Error('RPC interrupted'));
    try {
      await backfill.scan({ job: 'test', batchSize: 2 });
      expect.fail('expected interruption');
    } catch (error) { expect(error.message).to.equal('RPC interrupted'); }
    expect((await backfill.status('test')).nextBlock).to.equal(12);
    provider.getEvents.resolves([rawEvent(12, '0x0')]);
    await backfill.scan({ job: 'test', batchSize: 2 });
    expect(provider.getEvents.lastCall.args[0].fromBlock).to.equal(12);
    expect((await backfill.status('test')).cleared).to.equal(1);
    try {
      await backfill.scan({ job: 'test', toBlock: 13 });
      expect.fail('expected bounds rejection');
    } catch (error) { expect(error.message).to.include('Block bounds differ'); }
  });

  it('does not overwrite a newer live tenancy', async function () {
    provider.getEvents.resolves([rawEvent(10, tenant.uuid)]);
    await backfill.scan({ job: 'test' });
    const newer = await mongoose.model('Starknet').create(Handler.parseEvent(rawEvent(13, '0x0')));
    await new Handler(newer).processEvent();
    const result = await backfill.apply({ job: 'test', processorStopped: true });
    expect(result.skippedNewer).to.equal(1);
    expect((await mongoose.model('UseLotComponent').findOne()).tenant).to.equal(null);
  });

  it('retries an interrupted apply without duplicate source events', async function () {
    provider.getEvents.resolves([rawEvent(10, tenant.uuid)]);
    await backfill.scan({ job: 'test' });
    ElasticSearchService.queueEntityForIndexing.onFirstCall().rejects(new Error('index unavailable'));
    try {
      await backfill.apply({ job: 'test', processorStopped: true });
      expect.fail('expected interruption');
    } catch (error) { expect(error.message).to.equal('index unavailable'); }
    expect((await backfill.status('test')).phase).to.equal('apply');
    await backfill.apply({ job: 'test', processorStopped: true });
    expect(await mongoose.model('Starknet').countDocuments()).to.equal(1);
    expect((await backfill.status('test')).applied).to.equal(1);
    expect((await mongoose.model('UseLotComponent').findOne()).tenant.id).to.equal(tenant.id);
    await backfill.apply({ job: 'test', processorStopped: true });
    expect(ElasticSearchService.queueEntityForIndexing.callCount).to.equal(2);
  });

  it('leaves business data and checkpoints unchanged in dry run', async function () {
    provider.getEvents.resolves([rawEvent(10, tenant.uuid)]);
    expect((await backfill.scan({ job: 'test', dryRun: true })).matched).to.equal(1);
    expect(await backfill.jobs.countDocuments()).to.equal(0);
    expect(await backfill.lots.countDocuments()).to.equal(0);
    expect(await mongoose.model('Starknet').countDocuments()).to.equal(0);
    await backfill.scan({ job: 'test' });
    await backfill.apply({ job: 'test', dryRun: true });
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(0);
    expect((await backfill.status('test')).phase).to.equal('ready');
  });

  it('orders updates within a transaction and refuses a changed cutoff hash', async function () {
    provider.getEvents.resolves([rawEvent(12, '0x0', 2), rawEvent(12, tenant.uuid, 1)]);
    await backfill.scan({ job: 'test' });
    expect((await backfill.status('test')).cleared).to.equal(1);
    provider.getBlock.resolves({ blockNumber: 12, blockHash: '0xd', status: 'ACCEPTED_ON_L1' });
    try {
      await backfill.apply({ job: 'test', processorStopped: true });
      expect.fail('expected cutoff mismatch');
    } catch (error) { expect(error.message).to.include('cutoff no longer matches'); }
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(0);
  });

  it('requires processor acknowledgement and finalized cutoff', async function () {
    try {
      await backfill.apply({ job: 'test' });
      expect.fail('expected acknowledgement');
    } catch (error) { expect(error.message).to.include('--processorStopped'); }
    provider.getBlock.resolves({ blockNumber: 12, blockHash: '0xc', status: 'ACCEPTED_ON_L2' });
    try {
      await backfill.scan({ job: 'test' });
      expect.fail('expected finality check');
    } catch (error) { expect(error.message).to.include('finalized'); }
    expect(await backfill.jobs.countDocuments()).to.equal(0);
  });
});
