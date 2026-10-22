const { expect } = require('chai');
const mongoose = require('mongoose');
const Koa = require('koa');
const request = require('supertest');
const { Address, Building, ColonizationMission, Entity, Mission, MissionObservation } = require('@influenceth/sdk');
const { shortString } = require('starknet');
const { cellData, subjectUuid } = require('@common/lib/missions');
const ColonyService = require('@common/services/ColonizationMission');
const ObservationService = require('@common/services/MissionObservation');
const MissionService = require('@common/services/Mission');
const { observationInput } = require('@common/lib/missionObservation');
const ConstantHandler = require('@common/lib/events/handlers/starknet/Dispatcher/ConstantRegistered');
const ComponentHandler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Mission');
const router = require('@api/controllers/missions');
const LocationHandler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Location');
const { ElasticSearchService } = require('@common/services');

const campaign = '789';
const subject = { label: Entity.IDS.ASTEROID, id: '42' };
const assignment = { campaign, subject, mission: 0 };
const owner = Address.toStandard('0xabc', 'starknet');
const other = Address.toStandard('0xdef', 'starknet');
const cell = (path, value, extra = {}) => {
  const data = cellData(path, value);
  return mongoose.model('MissionComponent').findOneAndUpdate(
    { pathKey: data.pathKey },
    { $set: { ...data, ...extra } },
    { upsert: true }
  );
};
const evidence = (slot, value) => cell(Mission.getEvidencePath(assignment, slot), value);
const lifecycle = (flags) => {
  const word = flags.reduce((total, flag, mission) => total + [0, 1, 2].reduce((bits, offset) => (
    bits + BigInt((flag >> offset) & 1) * (2n ** BigInt(offset * 32 + mission))
  ), 0n), 0n);
  return cell(Mission.getLifecyclePath(assignment), word);
};
const activate = async () => {
  await mongoose.model('Constant').create({ name: 'COLONIZATION_CAMPAIGN', value: campaign });
  await cell(Mission.getPath({ type: 'Definition', campaign }), '1234');
  await cell(Mission.getPath({ type: 'DefinitionCount', campaign }), '5');
  await mongoose.model('CelestialComponent').create({ entity: subject, scanStatus: 0 });
  await mongoose.model('NftComponent').create({ entity: subject, owners: { starknet: owner } });
  await Promise.all([0, 1, 2, 3, 4].map((missionId) => cell(
    ColonizationMission.getRewardPath({ campaign, missionId }),
    ColonizationMission.getRewardAmount(missionId),
    { namespace: 'Unknown', campaign: undefined }
  )));
};
const enroll = async (flags = [3, 0, 0, 0, 0]) => {
  await lifecycle(flags);
  await evidence(ColonizationMission.EVIDENCE_SLOTS.COLONIZER, owner);
  await evidence(ColonizationMission.EVIDENCE_SLOTS.EARNED, '1');
  await evidence(ColonizationMission.EVIDENCE_SLOTS.SCAN_FINISHED, '100');
};
const building = async (id, mission, { asteroidId = 42, status = 3, used = true, finishTime = '200' } = {}) => {
  const entity = { label: Entity.IDS.BUILDING, id };
  const kind = ColonizationMission.TYPES[mission].requirements.buildingType;
  const data = { building_type: kind, planned_at: '50', finish_time: finishTime };
  const event = await mongoose.model('Starknet').create({
    event: 'ComponentUpdated_Building',
    name: 'ComponentUpdated',
    address: '0x1',
    blockHash: '0x1',
    blockNumber: 1,
    transactionHash: `0x${id}`,
    transactionIndex: 0,
    logIndex: Number(id),
    timestamp: 100,
    data: ['1', subjectUuid(entity), String(status), String(kind), '50', finishTime],
    keys: ['0x1']
  });
  await mongoose.model('BuildingComponent').findOneAndUpdate({ 'entity.uuid': subjectUuid(entity) }, {
    $set: { entity: { ...entity, uuid: subjectUuid(entity) }, buildingType: kind, status, event: { id: event.id } }
  }, { upsert: true });
  await mongoose.model('LocationComponent').create({
    entity, location: { label: Entity.IDS.LOT, id: 2 ** 32 + asteroidId }
  });
  const fingerprint = ColonizationMission.getBuildingFingerprint(entity, data);
  await evidence(mission, id);
  await evidence(ColonizationMission.getActionEvidenceSlot({ kind: 'Built', entity }), fingerprint);
  if (used) await evidence(ColonizationMission.getActionEvidenceSlot({ kind: 'Used', entity }), fingerprint);
  return { entity, event, fingerprint };
};

describe('Colonization missions and observer candidates', function () {
  afterEach(async function () {
    await this.utils.resetCollections([
      'MissionComponent', 'Constant', 'CelestialComponent', 'NftComponent', 'BuildingComponent',
      'LocationComponent', 'Starknet'
    ]);
  });

  it('requires activation and an unscanned owned asteroid to enroll', async function () {
    expect((await ColonyService.getSummary('42')).active).to.equal(false);
    await activate();
    const result = await ColonyService.getSummary('42');
    expect(result.canEnroll).to.equal(true);
    expect(result.missions[0].canAccept).to.equal(true);
    expect(result.missions[1].canAccept).to.equal(false);
    expect(result.missions.map((mission) => mission.rewardMicroSway)).to.deep.equal([
      '150000000000', '250000000000', '300000000000', '350000000000', '450000000000'
    ]);
    await mongoose.model('CelestialComponent').updateOne({}, { scanStatus: 1 });
    expect((await ColonyService.getSummary('42')).canEnroll).to.equal(false);
    await mongoose.model('CelestialComponent').updateOne({}, { scanStatus: 2 });
    expect((await ColonyService.getSummary('42')).canEnroll).to.equal(false);
  });

  it('keeps earned evidence independent of acceptance and enforces original ownership', async function () {
    await activate();
    await enroll([3, 3, 0, 0, 0]);
    await evidence(ColonizationMission.EVIDENCE_SLOTS.EARNED, '3');
    let result = await ColonyService.getSummary('42');
    expect(result.missions[1].claimable).to.equal(true);
    expect(result.missions.slice(2).every((mission) => mission.canAccept)).to.equal(true);
    await mongoose.model('NftComponent').updateOne({}, { 'owners.starknet': other });
    result = await ColonyService.getSummary('42');
    expect(result.colonizer).to.equal(owner);
    expect(result.missions[1].claimBlockedReason).to.equal('colonizer_not_owner');
    expect(result.missions[2].canAccept).to.equal(false);
    await mongoose.model('NftComponent').updateOne({}, { 'owners.starknet': owner });
    expect((await ColonyService.getSummary('42')).missions[1].claimable).to.equal(true);
    await lifecycle([3, 7, 0, 0, 0]);
    expect((await ColonyService.getSummary('42')).missions[1].claimBlockedReason).to.equal('already_claimed');
  });

  it('requires completion of the scan mission before accepting branches', async function () {
    await activate();
    await enroll([1, 0, 0, 0, 0]);
    expect((await ColonyService.getSummary('42')).missions[1].canAccept).to.equal(false);
  });

  it('rechecks selected buildings while preserving historical branch rewards', async function () {
    await activate();
    await enroll([3, 3, 3, 3, 3]);
    await evidence(ColonizationMission.EVIDENCE_SLOTS.EARNED, '15');
    await building('101', 1);
    await building('102', 2);
    const market = await building('103', 3);
    let result = await ColonyService.getSummary('42');
    expect(result.progress.capstoneReady).to.equal(true);
    expect(result.missions[4].claimable).to.equal(true);
    await mongoose.model('Starknet').updateOne({ _id: market.event.id }, { 'data.2': '0' });
    result = await ColonyService.getSummary('42');
    expect(result.missions[4].completed).to.equal(true);
    expect(result.missions[4].claimBlockedReason).to.equal('colony_not_operational');
    expect(result.missions[3].claimable).to.equal(true);
    await building('104', 3);
    expect((await ColonyService.getSummary('42')).missions[4].claimable).to.equal(true);
  });

  it('rejects wrong locations, missing use evidence and changed construction fingerprints', async function () {
    await activate();
    await enroll([3, 3, 3, 3, 3]);
    await building('101', 1, { asteroidId: 43 });
    await building('102', 2, { used: false });
    const market = await building('103', 3, { finishTime: '9007199254740993' });
    await mongoose.model('Starknet').updateOne({ _id: market.event.id }, { 'data.5': '9007199254740994' });
    const result = await ColonyService.getSummary('42');
    expect(result.progress.selectedBuildings.map((item) => item.reason)).to.deep.equal([
      'wrong_asteroid', 'use_not_observed', 'construction_not_observed'
    ]);
  });

  it('discovers third-party trade candidates before branch acceptance, without a starter campaign', async function () {
    await activate();
    await enroll();
    const market = await building('103', 3);
    for (const system of ['FillBuyOrder', 'FillSellOrder']) {
      const result = await ObservationService.getCandidates({ system, target: market.entity });
      expect(result.candidates.map((candidate) => candidate.mission)).to.deep.equal([3, 4]);
      expect(result.candidates[0].subject).to.deep.equal(subject);
      expect(() => MissionObservation.encodeMissionTargets(result.candidates)).not.to.throw();
    }
  });

  it('routes construction and use by enrollment and building type before branch acceptance', async function () {
    await activate();
    const habitat = await building('101', 1);
    const input = { system: 'ConstructionStart', target: habitat.entity };
    expect((await ObservationService.getCandidates(input)).candidates).to.deep.equal([]);
    await enroll();
    const construction = await ObservationService.getCandidates(input);
    expect(construction.candidates.map((c) => c.mission)).to.deep.equal([1]);
    expect((await ObservationService.getCandidates({ ...input, system: 'DockShip' })).candidates).to.deep.equal([]);
    expect((await ObservationService.getCandidates({ ...input, system: 'StationCrew' })).candidates
      .map((c) => c.mission)).to.deep.equal([1, 4]);
  });

  it('combines starter and colony candidates and includes unaccepted production/storage missions', async function () {
    await activate();
    await enroll();
    const market = await building('103', 3);
    this._sandbox.stub(MissionService, 'getStarter').resolves({
      active: true,
      eligible: true,
      campaign: '123',
      subject: { label: Entity.IDS.CREW, id: '501' },
      missions: [{ accepted: true }],
      progress: { warehouseId: null }
    });
    const result = await ObservationService.getCandidates({
      system: 'FillSellOrder', target: market.entity, crewId: '501'
    });
    expect(result.candidates.map((c) => [c.campaign, c.mission])).to.deep.equal([
      ['123', 3], ['123', 7], [campaign, 3], [campaign, 4]
    ]);
    const refinery = { label: Entity.IDS.BUILDING, id: '201' };
    await mongoose.model('BuildingComponent').create({ entity: refinery, buildingType: Building.IDS.REFINERY });
    const production = await ObservationService.getCandidates({
      system: 'ProcessProductsStart', target: refinery, crewId: '501'
    });
    expect(production.candidates.map((c) => c.mission)).to.deep.equal([4, 3, 7]);
  });

  it('only nominates an enrolled scan in the matching phase and with its original owner', async function () {
    await activate();
    await enroll([1, 0, 0, 0, 0]);
    await evidence(ColonizationMission.EVIDENCE_SLOTS.EARNED, '0');
    const start = { system: 'ScanSurfaceStart', target: subject };
    const finish = { system: 'ScanSurfaceFinish', target: subject };
    expect((await ObservationService.getCandidates(start)).candidates).to.have.length(1);
    expect((await ObservationService.getCandidates(finish)).candidates).to.have.length(0);
    await mongoose.model('CelestialComponent').updateOne({}, { scanStatus: 1 });
    expect((await ObservationService.getCandidates(finish)).candidates).to.have.length(0);
    await evidence(ColonizationMission.EVIDENCE_SLOTS.SCAN_STARTED, '1234');
    expect((await ObservationService.getCandidates(start)).candidates).to.have.length(0);
    expect((await ObservationService.getCandidates(finish)).candidates).to.have.length(1);
    await mongoose.model('NftComponent').updateOne({}, { 'owners.starknet': other });
    expect((await ObservationService.getCandidates(finish)).candidates).to.have.length(0);
  });

  it('does not infer mission evidence from ordinary native state', async function () {
    await activate();
    await enroll([1, 0, 0, 0, 0]);
    await evidence(ColonizationMission.EVIDENCE_SLOTS.EARNED, '0');
    await evidence(ColonizationMission.EVIDENCE_SLOTS.SCAN_FINISHED, '0');
    await mongoose.model('CelestialComponent').updateOne({}, { scanStatus: 2 });
    const result = await ColonyService.getSummary('42');
    expect(result.progress.earned.scan).to.equal(false);
    expect(result.missions[0].completed).to.equal(false);
    expect(result.missions[1].canAccept).to.equal(false);
  });

  it('nominates construction economic use and reuses SDK building requirements', async function () {
    this._sandbox.stub(MissionService, 'getStarter').resolves({
      active: true,
      eligible: true,
      campaign: '123',
      subject: { label: Entity.IDS.CREW, id: '501' },
      missions: [{ accepted: true }],
      progress: { warehouseId: '201' }
    });
    for (const [kind, mission] of [[Building.IDS.WAREHOUSE, 3], [Building.IDS.EXTRACTOR, 2],
      [Building.IDS.REFINERY, 4], [Building.IDS.BIOREACTOR, 5], [Building.IDS.FACTORY, 6]]) {
      const entity = { label: Entity.IDS.BUILDING, id: '201' };
      await mongoose.model('BuildingComponent').deleteMany({});
      await mongoose.model('BuildingComponent').create({ entity, buildingType: kind });
      const input = { system: 'ConstructionStart', target: entity, crewId: '501' };
      expect((await ObservationService.getCandidates(input)).candidates.map((c) => c.mission))
        .to.deep.equal([mission, 7]);
      expect((await ObservationService.getCandidates({ ...input, system: 'ConstructionFinish' }))
        .candidates.map((c) => c.mission)).to.deep.equal([mission]);
    }
  });

  it('does not load capstone sources or unrelated starter state for colony buy candidates', async function () {
    await activate();
    await enroll();
    const market = await building('103', 3);
    this._sandbox.stub(ColonyService, 'getSelectedBuildings').throws(new Error('Unnecessary capstone read'));
    this._sandbox.stub(MissionService, 'getStarter').throws(new Error('Unsupported starter action'));
    const result = await ObservationService.getCandidates({
      system: 'FillBuyOrder', target: market.entity, crewId: '501'
    });
    expect(result.candidates.map((c) => c.mission)).to.deep.equal([3, 4]);
  });

  it('handles missing or removed source events without claiming capstone readiness', async function () {
    await activate();
    await enroll([3, 3, 3, 3, 3]);
    const habitat = await building('101', 1);
    const port = await building('102', 2);
    const market = await building('103', 3);
    await mongoose.model('Starknet').deleteOne({ _id: habitat.event.id });
    await mongoose.model('Starknet').updateOne({ _id: port.event.id }, { removed: true });
    await mongoose.model('Starknet').updateOne({ _id: market.event.id }, { data: [] });
    const result = await ColonyService.getSummary('42');
    expect(result.missions[4].claimable).to.equal(false);
    expect(result.progress.selectedBuildings.map((item) => item.reason))
      .to.deep.equal(Array(3).fill('source_event_unavailable'));
  });

  it('refreshes both asteroid rooms on a building move and ignores an older location event', async function () {
    await activate();
    const habitat = await building('101', 1);
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    const eventForLocation = async (asteroidId, blockNumber) => {
      const raw = {
        data: ['1', subjectUuid(habitat.entity), String(Entity.IDS.LOT), String(2 ** 32 + asteroidId)],
        keys: LocationHandler.eventConfig.keys
      };
      return mongoose.model('Starknet').create({
        ...LocationHandler.parseEvent(raw),
        address: '0x1',
        blockHash: '0x1',
        blockNumber,
        transactionHash: `0x${blockNumber}`,
        transactionIndex: 0,
        logIndex: 0,
        timestamp: blockNumber
      });
    };
    const move = new LocationHandler(await eventForLocation(43, 200));
    await move.processEvent();
    expect(move.messages._messages.map((message) => message.to)).to.deep.equal(['Asteroid::42', 'Asteroid::43']);
    const stale = new LocationHandler(await eventForLocation(42, 150));
    await stale.processEvent();
    expect(stale.messages._messages).to.have.length(0);
    const location = await mongoose.model('LocationComponent').findOne({
      'entity.uuid': subjectUuid(habitat.entity)
    }).lean();
    expect(location.locations.find((item) => item.label === Entity.IDS.ASTEROID).id).to.equal(43);
  });

  it('notifies clients when colony configuration or rewards change', async function () {
    const handler = new ConstantHandler({
      _id: new mongoose.Types.ObjectId(),
      timestamp: 1,
      returnValues: ConstantHandler.transformEventData({
        data: [shortString.encodeShortString('COLONIZATION_CAMPAIGN'), campaign]
      })
    });
    await handler.processEvent();
    expect(handler.messages._messages).to.deep.equal([{}]);
    const data = cellData(ColonizationMission.getRewardPath({ campaign, missionId: 0 }), '10');
    const reward = new ComponentHandler({
      _id: new mongoose.Types.ObjectId(),
      timestamp: 1,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 1,
      returnValues: data
    });
    await reward.processEvent();
    expect(reward.messages._messages).to.deep.equal([{}]);
  });

  it('serves summaries and candidates and rejects malformed input', async function () {
    await activate();
    const app = new Koa();
    app.use(router.routes());
    const server = request(app.callback());
    const auth = `Bearer ${this.GLOBALS.token}`;
    await server.get('/v2/missions/colonization/42').set('Authorization', auth).expect(200);
    await server.get('/v2/missions/colonization/0').set('Authorization', auth).expect(400);
    await server.get('/v2/missions/observation-candidates').query({
      system: 'ScanSurfaceStart', targetUuid: subjectUuid(subject)
    }).set('Authorization', auth).expect(200);
    await server.get('/v2/missions/observation-candidates').query({
      system: 'FillBuyOrder', targetUuid: subjectUuid(subject)
    }).set('Authorization', auth).expect(400);
    expect(() => observationInput({ system: ['ScanSurfaceStart'], targetUuid: subjectUuid(subject) })).to.throw();
    expect(() => observationInput({
      system: 'ConstructionPlan', targetUuid: subjectUuid({ label: Entity.IDS.LOT, id: '4294967338' }), buildingType: 0
    })).to.throw();
    expect(() => observationInput({ system: 'toString', targetUuid: subjectUuid(subject) })).to.throw();
    expect(() => observationInput({ system: 'ConstructionPlan', targetUuid: subjectUuid(subject) })).to.throw();
  });
});
