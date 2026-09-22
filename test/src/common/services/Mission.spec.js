const { expect } = require('chai');
const mongoose = require('mongoose');
const Koa = require('koa');
const request = require('supertest');
const appConfig = require('config');
const { Mission, StarterMission, Entity, Address } = require('@influenceth/sdk');
const { hash, shortString } = require('starknet');
const EventProcessor = require('@common/lib/events/processor/EventProcessor');
const MissionService = require('@common/services/Mission');
const { cellData, pathKey } = require('@common/lib/missions');
const ComponentHandler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Mission');
const lifecycleHandlers = require('@common/lib/events/handlers/starknet/Dispatcher/systems/MissionLifecycle');
const ConstantHandler = require('@common/lib/events/handlers/starknet/Dispatcher/ConstantRegistered');
const RetrieverConfig = require('@common/lib/events/retrievers/starknet/config');
const ProcessorConfig = require('@common/lib/events/processor/config');
const router = require('@api/controllers/missions');
const emitter = require('@common/lib/sio/emitter');
const { ElasticSearchService, CrewReadyNotificationService } = require('@common/services');
const CrewV0 = require('@common/lib/events/handlers/starknet/Dispatcher/components/Crew/v0');
const CrewV1 = require('@common/lib/events/handlers/starknet/Dispatcher/components/Crew/v1');

const dispatcherHandlers = require('@common/lib/events/handlers/starknet/Dispatcher');

const campaign = '123';
const subject = { label: Entity.IDS.CREW, id: '501' };
const uuid = Entity.packEntity(subject);
const assignment = { campaign, subject, mission: 0 };
let sequence = 0;

const eventFor = async (Handler, data, overrides = {}) => {
  sequence += 1;
  const raw = { data, keys: Handler.eventConfig.keys };
  return mongoose.model('Starknet').create({
    event: Handler.eventName,
    name: Handler.baseName,
    address: appConfig.get('Contracts.starknet.dispatcher'),
    blockHash: '0x123',
    blockNumber: 10,
    transactionIndex: 0,
    transactionHash: `0x${sequence.toString(16)}`,
    logIndex: sequence,
    timestamp: 1000,
    ...raw,
    returnValues: Handler.transformEventData(raw),
    ...overrides
  });
};
const writeCell = async (path, value, overrides) => {
  const event = await eventFor(ComponentHandler, [path.length, ...path.map(String), String(value)], overrides);
  const handler = new ComponentHandler(event);
  await handler.processEvent();
  return handler;
};
const register = async (id = campaign, count = 8) => {
  await writeCell(Mission.getPath({ type: 'Definition', campaign: id }), 456);
  await writeCell(Mission.getPath({ type: 'DefinitionCount', campaign: id }), count);
};
const activate = async () => {
  await register();
  await mongoose.model('Constant').create([
    { name: 'STARTER_MISSION_CAMPAIGN', value: campaign },
    { name: 'STARTER_MISSION_CUTOFF', value: '500' }
  ]);
  await mongoose.model('CrewComponent').create({ entity: subject, roster: [1], delegatedTo: '0xabc' });
};

describe('Mission indexing and API', function () {
  let server;
  let processorRegistry;
  let retrieverRegistry;

  beforeEach(function () {
    processorRegistry = ProcessorConfig.config;
    retrieverRegistry = RetrieverConfig.config;
    // Other suites replace registries and config addresses; build from the real Dispatcher exports.
    const address = appConfig.get('Contracts.starknet.dispatcher');
    const handlers = Object.values(dispatcherHandlers);
    this._sandbox.stub(ProcessorConfig, 'config').get(() => ({
      ...processorRegistry,
      [Address.toStandard(address)]: Object.fromEntries(handlers.map((handler) => [handler.eventName, handler]))
    }));
    this._sandbox.stub(RetrieverConfig, 'config').get(() => ({
      ...retrieverRegistry,
      [Address.toStandard(address, 'starknet')]: Object.fromEntries(
        handlers.map((handler) => [handler.eventNameKey, handler])
      )
    }));
    const app = new Koa();
    app.use(router.routes());
    server = request(app.callback());
  });

  afterEach(async function () {
    this._sandbox.restore();
    expect(ProcessorConfig.config).to.equal(processorRegistry);
    expect(RetrieverConfig.config).to.equal(retrieverRegistry);
    await this.utils.resetCollections(['MissionComponent', 'Constant', 'CrewComponent', 'Activity', 'Starknet']);
  });

  it('registers component and lifecycle selectors for retrieval and processing', function () {
    for (const Handler of [ComponentHandler, ...Object.values(lifecycleHandlers)]) {
      const address = appConfig.get('Contracts.starknet.dispatcher');
      expect(RetrieverConfig.getHandler({ address, keys: Handler.eventConfig.keys })).to.equal(Handler);
      expect(ProcessorConfig.getHandlerByAddressAndEvent({ address, eventName: Handler.eventName })).to.equal(Handler);
    }
  });

  it('keeps unrelated contract handlers available in the scoped registries', function () {
    for (const [address, handlers] of Object.entries(processorRegistry)) {
      if (address !== Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'))) {
        expect(ProcessorConfig.config[address]).to.equal(handlers);
      }
    }
    for (const [address, handlers] of Object.entries(retrieverRegistry)) {
      if (address !== Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'), 'starknet')) {
        expect(RetrieverConfig.config[address]).to.equal(handlers);
      }
    }
  });

  it('normalizes equivalent paths and preserves large felts and subject IDs', async function () {
    const largeSubject = { label: 2, id: (2n ** 64n - 1n).toString() };
    const path = Mission.getEvidencePath({ campaign: 2n ** 200n, subject: largeSubject }, 2n ** 240n);
    const value = 2n ** 250n;
    await writeCell(path, value);
    await writeCell(path.map((item) => `0x${item.toString(16)}`), value + 1n);
    const docs = await mongoose.model('MissionComponent').find().lean();
    expect(docs).to.have.length(1);
    expect(docs[0].value).to.equal((value + 1n).toString());
    expect(docs[0].subjectUuid).to.equal(Entity.packEntity(largeSubject));
  });

  it('retains unknown namespaces losslessly and does not publish execution-lock changes', async function () {
    await writeCell([99, 123], 42);
    const lock = await writeCell(Mission.getPath({ type: 'ExecutionLock' }), 1);
    expect(lock.messages._messages).to.have.length(0);
    expect(await mongoose.model('MissionComponent').countDocuments({ namespace: 'Unknown' })).to.equal(1);
  });

  it('rejects malformed component payloads and unsafe felt numbers', function () {
    for (const data of [[], [0, 1], [4, 1, 2], [1, 1, 2, 3]]) {
      expect(() => ComponentHandler.transformEventData({ data })).to.throw();
    }
    expect(() => cellData([99], Number.MAX_SAFE_INTEGER + 1)).to.throw();
    expect(() => cellData(Mission.getPath({ type: 'Definition', campaign }), 2n ** 252n)).to.throw();
  });

  it('orders by block, transaction and log; replay and zero clears preserve the latest cell', async function () {
    const path = Mission.getEvidencePath(assignment, 0);
    const latest = await writeCell(path, 0, { blockNumber: 20, transactionIndex: 2, logIndex: 5 });
    await writeCell(path, 100, { blockNumber: 19, transactionIndex: 3, logIndex: 6 });
    await writeCell(path, 200, { blockNumber: 20, transactionIndex: 1, logIndex: 6 });
    await writeCell(path, 300, { blockNumber: 20, transactionIndex: 2, logIndex: 4 });
    await latest.processEvent();
    const docs = await mongoose.model('MissionComponent').find().lean();
    expect(docs).to.have.length(1);
    expect(docs[0].value).to.equal('0');
    await writeCell(path, 400, { blockNumber: 20, transactionIndex: 2, logIndex: 6 });
    expect((await mongoose.model('MissionComponent').findOne().lean()).value).to.equal('400');
  });

  it('publishes subject progress and crew-global invalidation to the crew room', async function () {
    const emit = this._sandbox.stub(emitter, 'emitTo').resolves();
    const handler = await writeCell(Mission.getEvidencePath(assignment, 0), 256);
    await handler.emitSocketEvents();
    const invalidation = await writeCell(StarterMission.getInvalidPath(subject.id), 1);
    await invalidation.emitSocketEvents();
    expect(emit.callCount).to.equal(2);
    expect(emit.firstCall.args[0]).to.include({ to: 'Crew::501', type: 'ComponentUpdated_Mission' });
    expect(emit.secondCall.args[0].body.event.returnValues.namespace).to.equal('StarterInvalid');
  });

  it('broadcasts campaign definition and activation updates', async function () {
    const broadcast = this._sandbox.stub(emitter, 'broadcast').resolves();
    const definition = await writeCell(Mission.getPath({ type: 'Definition', campaign }), 456);
    await definition.emitSocketEvents();
    const event = await eventFor(ConstantHandler, [
      shortString.encodeShortString('STARTER_MISSION_CAMPAIGN'), campaign
    ]);
    const handler = new ConstantHandler(event);
    await handler.processEvent();
    await handler.emitSocketEvents();
    expect(broadcast.callCount).to.equal(2);
  });

  for (const name of ['MissionAccepted', 'MissionCompleted', 'MissionRewardClaimed']) {
    it(`records ${name} activity once on replay and preserves reward precision`, async function () {
      const Handler = lifecycleHandlers[name];
      const data = [campaign, 1, 501, 0];
      if (name === 'MissionRewardClaimed') data.push('0xabc', (2n ** 127n + 1n).toString());
      const event = await eventFor(Handler, data);
      const handler = new Handler(event);
      await handler.processEvent();
      await handler.processEvent();
      const activities = await mongoose.model('Activity').find().lean();
      expect(activities).to.have.length(1);
      expect(activities[0].event.returnValues.mission).to.equal(0);
      expect(activities[0].event.returnValues.campaign).to.equal(campaign);
      expect(handler.messages._messages[0].to).to.equal('Crew::501');
      if (name === 'MissionRewardClaimed') {
        expect(activities[0].event.returnValues.amount).to.equal((2n ** 127n + 1n).toString());
        expect(handler.messages._messages).to.have.length(2);
      }
      expect(Handler.eventConfig.keys[0]).to.equal(hash.getSelectorFromName(name));
    });
  }

  it('serves generic non-crew campaigns with independent lifecycle pages and bounded evidence', async function () {
    await register(campaign, 65);
    const asteroid = { label: Entity.IDS.ASTEROID, id: '5' };
    const other = { campaign, subject: asteroid, mission: 32 };
    await writeCell(Mission.getLifecyclePath(other), 1n + 2n ** 32n);
    for (const slot of [0, 1, 2]) await writeCell(Mission.getEvidencePath(other, slot), slot + 5);
    const base = `/v2/missions/campaigns/0x7b/subjects/${Entity.packEntity(asteroid)}`;
    const response = await server.get(`${base}?page=1`).set('Origin', 'http://localhost.local');
    expect(response.status).to.equal(200);
    expect(response.body.missions).to.have.length(32);
    expect(response.body.missions[0]).to.deep.equal({ mission: 32, accepted: true, completed: true, claimed: false });
    expect((await MissionService.getSubject(campaign, subject)).missions[0].accepted).to.equal(false);
    const evidence = await server.get(`${base}/evidence?page=2&pageSize=2`).set('Origin', 'http://localhost.local');
    expect(evidence.status).to.equal(200);
    expect(evidence.body.total).to.equal(3);
    expect(evidence.body.cells).to.have.length(1);
    expect(evidence.body.cells[0].value).to.equal('7');
    expect((await MissionService.getSubject(campaign, asteroid, 2)).missions).to.have.length(1);
  });

  it('separates early earned evidence, completion, claiming and eligibility', async function () {
    await activate();
    await writeCell(Mission.getLifecyclePath(assignment), 1n + 2n ** 32n);
    await writeCell(Mission.getEvidencePath(assignment, 0), 3 + 3 * 256 + 1024);
    await writeCell(Mission.getEvidencePath(assignment, 1), 999);
    await writeCell(Mission.getEvidencePath(assignment, 100), 2n ** 127n);
    let response = await server.get('/v2/missions/starter/501').set('Origin', 'http://localhost.local');
    expect(response.status).to.equal(200);
    expect(response.body.active).to.equal(true);
    expect(response.body.eligible).to.equal(true);
    expect(response.body.progress).to.include({ sampleCount: 3, warehouseId: '999' });
    expect(response.body.progress.finalProductIds).to.include('127');
    expect(response.body.missions[1]).to.include({ earned: true, accepted: false, completed: false, canAccept: true });
    expect(response.body.missions[0]).to.include({ claimable: true, rewardMicroSway: '5000000000' });
    await writeCell(StarterMission.getInvalidPath(subject.id), 1);
    await writeCell(StarterMission.getParticipatedPath(subject.id), 1);
    response = await server.get('/v2/missions/starter/501').set('Origin', 'http://localhost.local');
    expect(response.body).to.include({ eligible: false, invalidated: true, participated: true });
    expect(response.body.missions[0].claimable).to.equal(true);
    expect(response.body.missions[1].canAccept).to.equal(false);
    await writeCell(Mission.getLifecyclePath(assignment), 1n + 2n ** 32n + 2n ** 64n);
    expect((await MissionService.getStarter('501')).missions[0].claimable).to.equal(false);
  });

  it('returns inactive without activation, and ineligible for missing/empty/cutoff crews', async function () {
    expect((await MissionService.getStarter('501')).active).to.equal(false);
    await activate();
    expect((await MissionService.getStarter('500')).eligible).to.equal(false);
    expect((await MissionService.getStarter('502')).eligible).to.equal(false);
    await mongoose.model('CrewComponent').updateOne({ 'entity.uuid': uuid }, { roster: [] });
    expect((await MissionService.getStarter('501')).eligible).to.equal(false);
    await mongoose.model('Constant').deleteOne({ name: 'STARTER_MISSION_CUTOFF' });
    expect((await MissionService.getStarter('501')).active).to.equal(false);
  });

  it('keeps campaigns and subjects isolated, and returns the current delegate', async function () {
    await activate();
    await register('456');
    await writeCell(Mission.getLifecyclePath({ ...assignment, campaign: '456' }), 1);
    expect((await MissionService.getSubject(campaign, subject)).missions[0].accepted).to.equal(false);
    await mongoose.model('CrewComponent').updateOne({ 'entity.uuid': uuid }, { delegatedTo: '0xdef' });
    expect((await MissionService.getStarter('501')).recipient).to.match(/def$/);
    expect(pathKey(Mission.getLifecyclePath(assignment))).not.to.equal(
      pathKey(Mission.getLifecyclePath({ ...assignment, mission: 32 }))
    );
  });

  it('processes all eight missions through the worker, including same-transaction completion', async function () {
    await activate();
    const emit = this._sandbox.stub(emitter, 'emitTo').resolves();
    this._sandbox.stub(emitter, 'broadcast').resolves();
    const events = [];
    let word = 0n;
    const path = Mission.getLifecyclePath(assignment);
    for (let mission = 0; mission < 8; mission += 1) {
      for (const [kind, name] of [[0, 'MissionAccepted'], [1, 'MissionCompleted'], [2, 'MissionRewardClaimed']]) {
        word += 2n ** BigInt(kind * 32 + mission);
        const overrides = { transactionHash: '0xffff', logIndex: events.length };
        events.push(await eventFor(ComponentHandler, [path.length, ...path.map(String), word.toString()], overrides));
        const data = [campaign, 1, 501, mission];
        if (kind === 2) data.push('0xabc', StarterMission.getRewardAmount(mission).toString());
        events.push(await eventFor(lifecycleHandlers[name], data, {
          transactionHash: '0xffff', logIndex: events.length
        }));
      }
    }
    const processor = new EventProcessor({ runDelay: 1000 });
    await processor.process({ events });
    await processor.process({ events });
    expect(await mongoose.model('Activity').countDocuments()).to.equal(24);
    expect(await mongoose.model('Starknet').countDocuments({
      transactionHash: events[0].transactionHash, lastProcessed: { $ne: null }
    })).to.equal(48);
    const result = await MissionService.getStarter('501');
    const allClaimed = result.missions.every((mission) => mission.claimed && mission.completed && !mission.claimable);
    expect(allClaimed).to.equal(true);
    const rewards = await mongoose.model('Activity').find({ 'event.name': 'MissionRewardClaimed' }).lean();
    expect(rewards.reduce((sum, item) => sum + BigInt(item.event.returnValues.amount), 0n)).to.equal(225000000000n);
    expect(emit.called).to.equal(true);
  });

  it('reads recorded final products outside SDK preview outputs and removes cleared progress', async function () {
    await activate();
    const product = 10000n;
    const slot = StarterMission.getFinalProductSlot(product);
    const path = Mission.getEvidencePath(assignment, slot);
    await writeCell(path, 2n ** (product % 128n));
    await writeCell(Mission.getEvidencePath(assignment, 2n ** 240n), 1);
    expect((await MissionService.getStarter('501')).progress.finalProductIds).to.deep.equal(['10000']);
    await writeCell(path, 0);
    expect((await MissionService.getStarter('501')).progress.finalProductIds).to.deep.equal([]);
  });

  it('notifies on crew roster/delegate changes, but not unrelated crew updates', async function () {
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    this._sandbox.stub(CrewReadyNotificationService, 'createOrUpdate').resolves();
    for (const Handler of [CrewV0, CrewV1]) {
      await mongoose.model('CrewComponent').deleteMany({});
      const data = [1, uuid, '0xabc', 1, 10, 0, 0, 0, 0, 0, 0, 0];
      if (Handler === CrewV1) data.push(0);
      const first = new Handler(await eventFor(Handler, data));
      await first.processEvent();
      expect(first.messages._messages).to.have.length(1);
      const unchanged = new Handler(await eventFor(Handler, data));
      await unchanged.processEvent();
      expect(unchanged.messages._messages).to.have.length(0);
      data[2] = '0xdef';
      const delegated = new Handler(await eventFor(Handler, data));
      await delegated.processEvent();
      expect(delegated.messages._messages).to.have.length(1);
      data[4] = 11;
      const roster = new Handler(await eventFor(Handler, data));
      await roster.processEvent();
      expect(roster.messages._messages).to.have.length(1);
    }
  });

  it('validates lifecycle payload lengths, mission indices and u128 reward amounts', function () {
    expect(() => lifecycleHandlers.MissionAccepted.transformEventData({ data: [123, 1, 501] })).to.throw();
    expect(() => lifecycleHandlers.MissionAccepted.transformEventData({ data: [123, 1, 501, 2 ** 32] })).to.throw();
    expect(() => lifecycleHandlers.MissionRewardClaimed.transformEventData({
      data: [123, 1, 501, 0, '0xabc', (2n ** 128n).toString()]
    })).to.throw();
  });

  it('rejects invalid API input and reports unknown campaigns', async function () {
    for (const url of [
      '/v2/missions/starter/0', '/v2/missions/starter/1.5', '/v2/missions/starter/18446744073709551616',
      '/v2/missions/campaigns/nope', `/v2/missions/campaigns/123/subjects/${uuid}?page=-1`,
      `/v2/missions/campaigns/123/subjects/${uuid}/evidence?pageSize=101`,
      '/v2/missions/campaigns/123/subjects/0'
    ]) {
      const response = await server.get(url).set('Origin', 'http://localhost.local');
      expect(response.status, url).to.equal(400);
    }
    const response = await server.get('/v2/missions/campaigns/999').set('Origin', 'http://localhost.local');
    expect(response.status).to.equal(404);
  });
});
