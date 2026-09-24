const { expect } = require('chai');
const mongoose = require('mongoose');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ElasticSearchService, EntityService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Unique');

const lot = Entity.lotFromIndex(1, 1);
const tenant = Entity.Crew(2);
const nextTenant = Entity.Crew(3);

const makeEvent = async (value, logIndex = 1, namespace = '0x5573654c6f74') => {
  const data = ['0x2', namespace, lot.uuid, value];
  return mongoose.model('Starknet').create({
    event: 'ComponentUpdated_Unique',
    blockNumber: 100,
    blockHash: '0xabc',
    timestamp: 1695691834,
    transactionIndex: 1,
    transactionHash: '0x123456789',
    logIndex,
    data,
    returnValues: Handler.transformEventData({ data })
  });
};

describe('ComponentUpdated: Unique tenancy handler', function () {
  beforeEach(function () {
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['UseLotComponent', 'PrepaidAgreementComponent', 'Event', 'Entity']);
  });

  it('decodes packed tenancy and zero clearing', function () {
    expect(Handler.transformEventData({ data: ['0x2', '0x5573654c6f74', lot.uuid, tenant.uuid] }))
      .to.deep.equal({ entity: { id: lot.id, label: lot.label }, tenant: { id: tenant.id, label: tenant.label } });
    expect(Handler.transformEventData({ data: ['0x2', '0x5573654c6f74', lot.uuid, '0x0'] }).tenant)
      .to.equal(null);
  });

  it('ignores occupancy and unrelated Unique paths', async function () {
    const event = await makeEvent('0x1', 1, '0x4c6f74557365');
    await new Handler(event).processEvent();
    expect(await mongoose.model('UseLotComponent').countDocuments()).to.equal(0);
    expect(ElasticSearchService.queueEntityForIndexing.called).to.equal(false);
    expect(Handler.transformEventData({ data: ['0x1', '0x1', '0x1'] })).to.deep.equal({});
  });

  it('assigns and replaces tenancy, indexing the lot and notifying both tenants', async function () {
    await new Handler(await makeEvent(tenant.uuid)).processEvent();
    const handler = new Handler(await makeEvent(nextTenant.uuid, 2));
    await handler.processEvent();
    const docs = await mongoose.model('UseLotComponent').find().lean();
    expect(docs).to.have.lengthOf(1);
    expect(docs[0].tenant.uuid).to.equal(nextTenant.uuid);
    expect(ElasticSearchService.queueEntityForIndexing.callCount).to.equal(2);
    expect(handler.messages.map(({ to }) => to)).to.have.members([
      `Lot::${lot.id}`, 'Asteroid::1', 'Crew::2', 'Crew::3'
    ]);
  });

  it('keeps clearing against older events without removing historical agreements', async function () {
    await mongoose.model('PrepaidAgreementComponent').create({
      entity: lot, permission: Permission.IDS.USE_LOT, permitted: tenant, startTime: 1, endTime: 2
    });
    const assignment = await makeEvent(tenant.uuid);
    await new Handler(assignment).processEvent();
    const clear = new Handler(await makeEvent('0x0', 2));
    await clear.processEvent();
    const stale = new Handler(assignment);
    await stale.processEvent();
    expect(stale.messages.map(({ to }) => to)).to.deep.equal([]);
    expect(ElasticSearchService.queueEntityForIndexing.callCount).to.equal(2);
    expect(clear.messages.map(({ to }) => to)).to.include('Crew::2');
    const result = await EntityService.getEntity({ format: true, uuid: lot.uuid });
    expect(result.UseLot.tenant).to.equal(null);
    expect(result.PrepaidAgreements).to.have.lengthOf(1);
  });

  it('exposes populated tenancy and leaves unpopulated lots distinguishable', async function () {
    await new Handler(await makeEvent(tenant.uuid)).processEvent();
    const result = await EntityService.getEntity({ format: true, uuid: lot.uuid });
    expect(result.UseLot.tenant.id).to.equal(tenant.id);
    const unknown = await EntityService.getEntity({ format: true, uuid: Entity.lotFromIndex(1, 2).uuid });
    expect(unknown.UseLot).to.equal(null);
  });
});
