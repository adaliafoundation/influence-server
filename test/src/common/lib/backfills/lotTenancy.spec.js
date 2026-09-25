const { expect } = require('chai');
const mongoose = require('mongoose');
const axios = require('axios');
const { Address, Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Unique');
const LotTenancyBackfill = require('@common/lib/backfills/lotTenancy');
const { RpcProvider } = require('@common/lib/starknet/providers');

const dispatcher = Address.toStandard('0x123', 'starknet');
const lot = Entity.lotFromIndex(1, 1);
const tenant = Entity.Crew(2);
const eventAt = async (blockNumber, value) => {
  const data = ['0x2', '0x5573654c6f74', lot.uuid, value];
  return mongoose.model('Starknet').create({
    event: Handler.eventName,
    blockNumber,
    blockHash: `0x${blockNumber.toString(16)}`,
    transactionHash: `0x${blockNumber.toString(16)}`,
    transactionIndex: 0,
    logIndex: 1,
    timestamp: blockNumber + 1000,
    data,
    returnValues: Handler.transformEventData({ data })
  });
};

describe('Lot tenancy state backfill', function () {
  let backfill;
  let provider;

  beforeEach(async function () {
    provider = {
      getBlock: this._sandbox.stub().resolves({ blockNumber: 12, blockHash: '0xc', status: 'ACCEPTED_ON_L1' }),
      getStorageAt: this._sandbox.stub().resolves(tenant.uuid)
    };
    backfill = new LotTenancyBackfill({ provider, dispatcher, log: () => {} });
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    await mongoose.model('PrepaidAgreementComponent').create({
      entity: lot, permission: Permission.IDS.USE_LOT, permitted: tenant, endTime: 1
    });
  });

  afterEach(async function () {
    await backfill.jobs.deleteMany({});
    await backfill.lots.deleteMany({});
    await this.utils.resetCollections([
      'UseLotComponent', 'Event', 'Entity', 'PrepaidAgreementComponent', 'ContractAgreementComponent',
      'WhitelistAgreementComponent', 'WhitelistAccountAgreementComponent', 'LocationComponent'
    ]);
  });

  it('reads each candidate at a fixed block and records snapshot provenance', async function () {
    const status = await backfill.scan({ job: 'test', delayMs: 0 });
    expect(status).to.include({ lots: 1, read: 1, assigned: 1, phase: 'ready' });
    expect(provider.getStorageAt.calledOnce).to.equal(true);
    expect(provider.getStorageAt.firstCall.args[0]).to.equal(dispatcher);
    // Vector independently obtained from influence-starknet's componentKey implementation.
    expect(provider.getStorageAt.firstCall.args[1])
      .to.equal('0x30ab43ae215caef7fb02069276343bdbcce0abaadde3dc8d6343ef2fad14d5d');
    expect(provider.getStorageAt.firstCall.args[2]).to.equal('0xc');
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(0);
    await backfill.apply({ job: 'test', processorStopped: true });
    const result = await mongoose.model('UseLotComponent').findOne();
    expect(result.tenant.id).to.equal(2);
    expect(result.snapshot.blockNumber).to.equal(12);
    expect(await mongoose.model('Event').countDocuments()).to.equal(0);
  });

  it('deduplicates all agreement types, building locations, and already indexed tenancy', async function () {
    for (const name of ['ContractAgreement', 'WhitelistAgreement', 'WhitelistAccountAgreement']) {
      await mongoose.model(`${name}Component`).create({
        entity: lot,
        permission: Permission.IDS.USE_LOT,
        permitted: name === 'WhitelistAccountAgreement' ? '0x123' : tenant
      });
    }
    await mongoose.model('LocationComponent').create({ entity: Entity.Building(1), location: lot });
    await mongoose.model('UseLotComponent').create({ entity: Entity.lotFromIndex(1, 2), tenant: null });
    await mongoose.model('LocationComponent').create({
      entity: Entity.Building(2), location: Entity.lotFromIndex(1, 3)
    });
    const result = await backfill.scan({ job: 'test', delayMs: 0 });
    expect(result.lots).to.equal(3);
    expect(provider.getStorageAt.callCount).to.equal(3);
  });

  it('resumes failed reads and never treats an RPC error as cleared tenancy', async function () {
    provider.getStorageAt.onFirstCall().rejects(new Error('RPC unavailable'));
    try {
      await backfill.scan({ job: 'test', delayMs: 0 });
      expect.fail('expected failure');
    } catch (error) { expect(error.message).to.equal('RPC unavailable'); }
    expect((await backfill.status('test')).read).to.equal(0);
    provider.getStorageAt.resolves('0x0');
    await backfill.scan({ job: 'test', delayMs: 0 });
    expect((await backfill.status('test')).cleared).to.equal(1);
    await backfill.scan({ job: 'test', delayMs: 0 });
    expect(provider.getStorageAt.callCount).to.equal(2);
  });

  it('protects snapshots from older and same-block events and accepts later live updates', async function () {
    provider.getStorageAt.resolves('0x0');
    await backfill.scan({ job: 'test', delayMs: 0 });
    await backfill.apply({ job: 'test', processorStopped: true });
    for (const block of [11, 12]) await new Handler(await eventAt(block, tenant.uuid)).processEvent();
    expect((await mongoose.model('UseLotComponent').findOne()).tenant).to.equal(null);
    await new Handler(await eventAt(13, tenant.uuid)).processEvent();
    const result = await mongoose.model('UseLotComponent').findOne().lean();
    expect(result.tenant.id).to.equal(2);
    expect(result.snapshot).to.equal(undefined);
  });

  it('preserves newer live events and newer snapshots', async function () {
    await backfill.scan({ job: 'test', delayMs: 0 });
    await new Handler(await eventAt(13, '0x0')).processEvent();
    expect((await backfill.apply({ job: 'test', processorStopped: true })).skippedNewer).to.equal(1);
    expect((await mongoose.model('UseLotComponent').findOne()).tenant).to.equal(null);
    await backfill.scan({ job: 'second', delayMs: 0 });
    await mongoose.model('UseLotComponent').deleteMany({});
    await mongoose.model('UseLotComponent').create({
      entity: lot, tenant: null, snapshot: { blockNumber: 14, blockHash: '0xe' }
    });
    expect((await backfill.apply({ job: 'second', processorStopped: true })).skippedNewer).to.equal(1);
  });

  it('resumes interrupted apply and requeues search indexing', async function () {
    await backfill.scan({ job: 'test', delayMs: 0 });
    ElasticSearchService.queueEntityForIndexing.onFirstCall().rejects(new Error('index unavailable'));
    try {
      await backfill.apply({ job: 'test', processorStopped: true });
      expect.fail('expected failure');
    } catch (error) { expect(error.message).to.equal('index unavailable'); }
    expect((await backfill.apply({ job: 'test', processorStopped: true })).applied).to.equal(1);
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(1);
    expect(ElasticSearchService.queueEntityForIndexing.callCount).to.equal(2);
  });

  it('estimates candidate count in dry run without storage reads or checkpoint writes', async function () {
    const result = await backfill.scan({ job: 'test', dryRun: true });
    expect(result.candidates).to.equal(1);
    expect(provider.getStorageAt.called).to.equal(false);
    expect(await backfill.jobs.countDocuments()).to.equal(0);
    expect(await backfill.lots.countDocuments()).to.equal(0);
  });

  it('requires pausing, rejects old jobs, and verifies snapshot finality', async function () {
    try {
      await backfill.apply({ job: 'test' });
      expect.fail('expected acknowledgement');
    } catch (error) { expect(error.message).to.include('--processorStopped'); }
    await backfill.jobs.insertOne({ _id: 'old', dispatcher });
    try {
      await backfill.scan({ job: 'old' });
      expect.fail('expected version rejection');
    } catch (error) { expect(error.message).to.include('version'); }
    provider.getBlock.resolves({ blockNumber: 12, blockHash: '0xc', status: 'ACCEPTED_ON_L2' });
    try {
      await backfill.scan({ job: 'test' });
      expect.fail('expected finality check');
    } catch (error) { expect(error.message).to.include('L1-accepted'); }
  });

  it('uses a pinned storage RPC and fails on RPC errors', async function () {
    const rpc = new RpcProvider({ endpoint: 'http://rpc.test' });
    this._sandbox.stub(rpc, '_callWithBackoff').callsFake((fn) => fn());
    const post = this._sandbox.stub(axios, 'post').resolves({ data: { result: '0x0' } });
    expect(await rpc.getStorageAt(dispatcher, '0x456', '0xc')).to.equal('0x0');
    expect(post.firstCall.args[1].params).to.deep.equal({
      contract_address: dispatcher, key: '0x456', block_id: { block_hash: '0xc' }
    });
    post.resolves({ data: { error: { code: 24, message: 'Block not found' } } });
    try {
      await rpc.getStorageAt(dispatcher, '0x456', '0xc');
      expect.fail('expected RPC error');
    } catch (error) { expect(error.message).to.include('Storage read failed'); }
  });
});
