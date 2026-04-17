const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Building } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, WAREHOUSE, EXTRACTOR, SHIPYARD, EMPTY_LOT,
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
      await setCrewBusy(CREW_1.id, 0);
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

    it('rejects when site inventory lacks required materials', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      // Clear site inventory contents
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { contents: [], mass: 0, volume: 0 } }
      );

      const res = await postAction(server, TOKEN, 'ConstructionStart', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient');

      // Restore site inventory contents
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: {
          contents: [
            { product: 44, amount: 400000 },
            { product: 69, amount: 350000 },
            { product: 70, amount: 200000 }
          ],
          mass: 950000000,
          volume: 867000000
        }}
      );
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

    it('creates warehouse inventory on slot 2', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      // Remove any existing operational inventory to verify it gets created on slot 2
      await mongoose.model('InventoryComponent').deleteMany({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      });

      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);

      // Verify inventory was created on slot 2
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      expect(inv).to.exist;
      expect(inv.inventoryType).to.equal(10);
      expect(inv.status).to.equal(1); // AVAILABLE
    });

    it('creates exactly 1 extractor for extractor building', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(EXTRACTOR.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      // Clear any existing extractors
      await mongoose.model('ExtractorComponent').deleteMany({
        'entity.id': EXTRACTOR.id, 'entity.label': 5
      });

      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: EXTRACTOR
      });

      expect(res.status).to.equal(200);

      const extractors = await mongoose.model('ExtractorComponent').find({
        'entity.id': EXTRACTOR.id, 'entity.label': 5
      }).lean();
      expect(extractors).to.have.lengthOf(1);
      expect(extractors[0].slot).to.equal(1);

      // Restore
      await setBuildingStatus(EXTRACTOR.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('creates both Processor and DryDock for shipyard', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(SHIPYARD.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      // Clear any existing components
      await mongoose.model('ProcessorComponent').deleteMany({
        'entity.id': SHIPYARD.id, 'entity.label': 5
      });
      await mongoose.model('DryDockComponent').deleteMany({
        'entity.id': SHIPYARD.id, 'entity.label': 5
      });

      const res = await postAction(server, TOKEN, 'ConstructionFinish', {
        caller_crew: CREW_1,
        building: SHIPYARD
      });

      expect(res.status).to.equal(200);

      const processors = await mongoose.model('ProcessorComponent').find({
        'entity.id': SHIPYARD.id, 'entity.label': 5
      }).lean();
      expect(processors).to.have.lengthOf(1);
      expect(processors[0].processorType).to.equal(4); // SHIPYARD

      const dryDocks = await mongoose.model('DryDockComponent').find({
        'entity.id': SHIPYARD.id, 'entity.label': 5
      }).lean();
      expect(dryDocks).to.have.lengthOf(1);

      // Restore
      await setBuildingStatus(SHIPYARD.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
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
      await setCrewBusy(CREW_1.id, 0);
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

    it('rejects when extractor is still running', async function () {
      // Ensure extractor building is OPERATIONAL
      await setBuildingStatus(EXTRACTOR.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);

      // Set an extractor component to RUNNING status
      await mongoose.model('ExtractorComponent').findOneAndUpdate(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        {
          entity: { id: EXTRACTOR.id, label: 5 },
          slot: 1, status: 1, outputProduct: 1, yield: 100, finishTime: Math.floor(Date.now() / 1000) + 99999
        },
        { upsert: true, new: true }
      );

      const res = await postAction(server, TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: EXTRACTOR
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('running');

      // Restore: set extractor back to IDLE
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, outputProduct: 0, yield: 0, finishTime: 0 } }
      );
      await setCrewBusy(CREW_1.id, 0);
    });

    it('sets crew busy after deconstruction', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);

      const res = await postAction(server, TOKEN, 'ConstructionDeconstruct', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(200);

      // Verify crew readyAt is set to a future time
      const crew = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      const now = Math.floor(Date.now() / 1000);
      expect(crew.readyAt).to.be.greaterThan(now - 5);

      // Restore
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
      await setCrewBusy(CREW_1.id, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConstructionAbandon
  // ═══════════════════════════════════════════════════════════════

  describe('ConstructionAbandon', function () {
    it('abandons a PLANNED building → UNPLANNED', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      // Empty the site inventory so the abandon check passes
      const origInv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1
      }).lean();
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { contents: [], mass: 0, volume: 0 } }
      );

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

      // Restore inventory and status
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { contents: origInv.contents, mass: origInv.mass, volume: origInv.volume } }
      );
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

    it('rejects when site inventory is not empty', async function () {
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.PLANNED);

      // Ensure site inventory has items
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { contents: [{ product: 44, amount: 100 }], mass: 100000 } }
      );

      const res = await postAction(server, TOKEN, 'ConstructionAbandon', {
        caller_crew: CREW_1,
        building: WAREHOUSE
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('empty');

      // Restore site inventory to original contents
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: {
          contents: [
            { product: 44, amount: 400000 },
            { product: 69, amount: 350000 },
            { product: 70, amount: 200000 }
          ],
          mass: 950000000,
          volume: 867000000
        }}
      );
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });
  });
});
