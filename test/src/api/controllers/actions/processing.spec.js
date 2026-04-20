const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Process, Processor } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, REFINERY, FACTORY, WAREHOUSE, SHIP_1,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy, setBuildingStatus, setInventoryStatus
} = require('@test/helpers/actionTestHelper');

// Steel Beam Rolling (process 57, factory/processorType 2):
//   input: 1 Steel (product 52) per recipe
//   output: ~62% yield Steel Beam (product 69) per recipe
// Warehouse slot 2 has: 2,000,000 Steel (52), 10,000,000 Steel Beam (69)

describe('Actions – Processing', function () {
  let server;
  let sandbox;

  before(async function () {
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
    server = buildActionServer();
  });

  afterEach(async function () {
    sandbox.restore();
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
  });

  after(function () {
    sandbox.restore();
  });

  // ═══════════════════════════════════════════════════════════════
  //  ProcessProductsStart
  // ═══════════════════════════════════════════════════════════════

  describe('ProcessProductsStart', function () {
    it('starts processing and subtracts inputs from origin inventory', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(0);
      expect(res.body.event.returnValues.process).to.equal(57);

      // Steel (product 52) should be reduced by 10 (1 per recipe × 10 recipes)
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const steel = inv.contents.find((c) => c.product === 52);
      expect(steel.amount).to.equal(2000000 - 10);

      // Mass/volume should be recomputed (less than original)
      expect(inv.mass).to.be.greaterThan(0);
      expect(inv.mass).to.be.lessThan(59125200000);

      // Processor should be RUNNING
      const proc = await mongoose.model('ProcessorComponent').findOne({
        'entity.id': FACTORY.id, 'entity.label': FACTORY.label, slot: 1
      }).lean();
      expect(proc.status).to.equal(Processor.STATUSES.RUNNING);
      expect(proc.runningProcess).to.equal(57);
      expect(proc.recipes).to.equal(10);
    });

    it('rejects when origin has insufficient input materials', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 2000001,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient');
      expect(res.body.error).to.include('Steel');
    });

    it('rejects when destination would exceed mass capacity', async function () {
      // Ship cargo (type 16, Medium Cargo Hold) has 2B mass capacity, currently
      // at 45M. Process 57 (Steel Beam Rolling) outputs 1 Steel Beam per Steel
      // input; 1.96M recipes → 1.96B output mass, overflowing the remaining
      // 1.955B free. Warehouse slot 2 has exactly 2M Steel (product 52), so
      // 1.96M is well within input supply.
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 1960000,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: SHIP_1.id, label: SHIP_1.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('mass');
    });

    it('rejects when origin inventory is unavailable', async function () {
      await setInventoryStatus(WAREHOUSE.id, WAREHOUSE.label, 2, 0);

      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not available');
    });

    it('rejects when origin inventory slot does not exist', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 99,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Origin inventory not found');
    });

    it('rejects when destination inventory slot does not exist', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 99
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Destination inventory not found');
    });

    it('rejects with invalid process type', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 99999,
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Invalid process');
    });

    it('rejects when recipes is zero', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 0,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');
    });

    it('rejects when processor slot is not idle', async function () {
      // Set processor to RUNNING
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': FACTORY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 1 } }
      );

      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('idle');

      // Cleanup
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': FACTORY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0 } }
      );
    });

    it('rejects when process type does not match processor', async function () {
      // Process 57 is a Factory process (processorType=2), try it on a Refinery (processorType=1)
      // First use a refinery process (23, Water Electrolysis, processorType=1) on a factory
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 23,
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('match');
    });

    it('rejects when building is not operational', async function () {
      // Set building to PLANNED (1)
      await setBuildingStatus(FACTORY.id, 1);

      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes: 10,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('operational');

      // Cleanup: restore to OPERATIONAL (3)
      await setBuildingStatus(FACTORY.id, 3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ProcessProductsFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ProcessProductsFinish', function () {
    async function startAndReadyProcess(recipes = 10) {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1,
        process: 57,
        recipes,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 2
      });
      expect(res.status).to.equal(200);

      // Set finishTime to the past so we can finish immediately
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': FACTORY.id, 'entity.label': FACTORY.label, slot: 1 },
        { $set: { finishTime: Math.floor(Date.now() / 1000) - 60 } }
      );
      // Reset crew readyAt
      await mongoose.model('CrewComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { readyAt: 0 } }
      );
    }

    it('finishes processing and adds outputs to destination inventory', async function () {
      const before = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const beamsBefore = before.contents.find((c) => c.product === 69).amount;

      await startAndReadyProcess(10);

      // Set phantom reservations on destination inventory
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2 },
        { $set: { reservedMass: 9999, reservedVolume: 9999 } }
      );

      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Steel Beams should be increased
      const after = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const beamsAfter = after.contents.find((c) => c.product === 69).amount;
      const expectedOutput = Process.getOutputs(57, 10, 0).find((o) => o.id === 69)?.amount || 0;
      expect(beamsAfter).to.equal(beamsBefore + expectedOutput);

      // Mass should be recomputed
      expect(after.mass).to.be.greaterThan(0);

      // Phantom reservations should be cleared
      expect(after.reservedMass).to.equal(0);
      expect(after.reservedVolume).to.equal(0);

      // Processor should be IDLE
      const proc = await mongoose.model('ProcessorComponent').findOne({
        'entity.id': FACTORY.id, 'entity.label': FACTORY.label, slot: 1
      }).lean();
      expect(proc.status).to.equal(Processor.STATUSES.IDLE);
      expect(proc.runningProcess).to.equal(0);
    });

    it('rejects when processor is not running', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not running');
    });

    it('rejects when processing has not finished yet', async function () {
      await startAndReadyProcess(10);

      // Override finishTime to the future
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': FACTORY.id, 'entity.label': FACTORY.label, slot: 1 },
        { $set: { finishTime: Math.floor(Date.now() / 1000) + 99999 } }
      );
      await mongoose.model('CrewComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { readyAt: 0 } }
      );

      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');
    });

    it('rejects when caller does not control crew', async function () {
      await startAndReadyProcess(10);

      const res = await postAction(server, WRONG_TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: { id: FACTORY.id, label: FACTORY.label },
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });
});
