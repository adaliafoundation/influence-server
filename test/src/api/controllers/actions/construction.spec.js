const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Building } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, WAREHOUSE, EMPTY_LOT,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setBuildingStatus, setCrewBusy,
  createEmptyLot
} = require('@test/helpers/actionTestHelper');

describe('Actions – Construction lifecycle', function () {
  let server;
  let sandbox;

  before(async function () {
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
    server = buildActionServer();
  });

  afterEach(function () {
    sandbox.restore();
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
  });

  after(function () {
    sandbox.restore();
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionPlan
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionPlan', function () {
    it('plans a building on an empty lot → PLANNED status', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 1, // Warehouse
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // The event returnValues should include the new building ref
      const rv = res.body.event.returnValues;
      expect(rv.building).to.have.property('id');
      expect(rv.building.id).to.be.greaterThan(100000000); // LOCAL_ID_OFFSET
      expect(rv.buildingType).to.equal(1);
      expect(rv.lot.id).to.equal(EMPTY_LOT.id);

      // Verify DB state: BuildingComponent exists with PLANNED status
      const bldgComp = await mongoose.model('BuildingComponent').findOne({
        'entity.id': rv.building.id, 'entity.label': 5
      }).lean();
      expect(bldgComp).to.exist;
      expect(bldgComp.status).to.equal(Building.CONSTRUCTION_STATUSES.PLANNED);
      expect(bldgComp.buildingType).to.equal(1);

      // Verify: Entity was created
      const entity = await mongoose.model('Entity').findOne({
        id: rv.building.id, label: 5
      }).lean();
      expect(entity).to.exist;

      // Verify: InventoryComponent created (site inventory)
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': rv.building.id, 'entity.label': 5
      }).lean();
      expect(inv).to.exist;
      expect(inv.status).to.equal(1); // AVAILABLE

      // Cleanup: remove the planned building
      await mongoose.model('BuildingComponent').deleteOne({ 'entity.id': rv.building.id });
      await mongoose.model('Entity').deleteOne({ id: rv.building.id, label: 5 });
      await mongoose.model('InventoryComponent').deleteMany({ 'entity.id': rv.building.id });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': rv.building.id });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': rv.building.id });
      await mongoose.model('NameComponent').deleteOne({ 'entity.id': rv.building.id });
    });

    it('rejects when building_type is missing', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('building_type is required');
    });

    it('rejects when caller_crew is missing', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        building_type: 1,
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('caller_crew');
    });

    it('rejects when lot is missing', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('lot');
    });

    it('rejects invalid building type', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 999,
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Invalid building type');
    });

    it('rejects when lot already has a building', async function () {
      // Lot id for building 1 (Warehouse) is at lotIndex=1 on asteroid 1
      const occupiedLot = { id: (1 * 4294967296) + 1, label: 4 };

      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 1,
        lot: occupiedLot
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('already has a building');
    });

    it('rejects when caller does not control the crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 1,
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'ConstructionPlan', {
        caller_crew: CREW_1,
        building_type: 1,
        lot: EMPTY_LOT
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      // Restore
      await setCrewBusy(CREW_1.id, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionStart
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionStart', function () {
    it('starts construction on a PLANNED building → UNDER_CONSTRUCTION', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
      expect(res.body.event.returnValues.finishTime).to.be.a('number');
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );

      // Verify DB: status is UNDER_CONSTRUCTION
      const bldg = await mongoose.model('BuildingComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5
      }).lean();
      expect(bldg.status).to.equal(Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION);
      expect(bldg.finishTime).to.be.greaterThan(0);

      // Restore
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when building is not in PLANNED status', async function () {
      // Warehouse is OPERATIONAL by default
      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when building is not found', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: { id: 999999, label: 5 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Building not found');
    });

    it('rejects when caller does not control the building', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      const res = await postAction(server, WRONG_TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');

      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects missing vars.building', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('building');
    });

    it('rejects when crew is busy', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionFinish', function () {
    it('finishes construction when finishTime has passed → OPERATIONAL', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify DB: building is OPERATIONAL
      const bldg = await mongoose.model('BuildingComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5
      }).lean();
      expect(bldg.status).to.equal(Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when building is not UNDER_CONSTRUCTION', async function () {
      // Warehouse is OPERATIONAL
      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when finishTime has not passed', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, futureTime);

      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');

      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when caller does not own the crew', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      const res = await postAction(server, WRONG_TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');

      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionDeconstruct
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionDeconstruct', function () {
    it('deconstructs OPERATIONAL building → PLANNED', async function () {
      const res = await postAction(server, TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify DB
      const bldg = await mongoose.model('BuildingComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5
      }).lean();
      expect(bldg.status).to.equal(Building.CONSTRUCTION_STATUSES.PLANNED);
      expect(bldg.finishTime).to.equal(0);

      // Restore
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when building is not OPERATIONAL', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      const res = await postAction(server, TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');

      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when caller does not control the building', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionAbandon
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionAbandon', function () {
    it('abandons a PLANNED building → UNPLANNED', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      const res = await postAction(server, TOKEN, 'ConstructionAbandon', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify DB
      const bldg = await mongoose.model('BuildingComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5
      }).lean();
      expect(bldg.status).to.equal(Building.CONSTRUCTION_STATUSES.UNPLANNED);

      // Restore
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('rejects when building is not PLANNED', async function () {
      // Warehouse is OPERATIONAL
      const res = await postAction(server, TOKEN, 'ConstructionAbandon', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when caller does not control the building', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      const res = await postAction(server, WRONG_TOKEN, 'ConstructionAbandon', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');

      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });
  });
});
