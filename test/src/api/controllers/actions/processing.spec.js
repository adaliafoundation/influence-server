const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Processor } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, REFINERY, WAREHOUSE,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy
} = require('@test/helpers/actionTestHelper');

describe('Actions – Processing', function () {
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
  //  ProcessProductsStart
  // ═══════════════════════════════════════════════════════════════

  describe('ProcessProductsStart', function () {
    it('starts processing with valid parameters', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1,
        process: 45, // Fungal Soilbuilding
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );
      expect(res.body.event.returnValues.process).to.equal(45);

      // Verify DB: Processor is RUNNING
      const proc = await mongoose.model('ProcessorComponent').findOne({
        'entity.id': REFINERY.id, 'entity.label': 5, slot: 1
      }).lean();
      expect(proc.status).to.equal(Processor.STATUSES.RUNNING);
      expect(proc.runningProcess).to.equal(45);
      expect(proc.recipes).to.equal(1);
      expect(proc.finishTime).to.be.greaterThan(0);

      // Cleanup
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, runningProcess: 0, recipes: 0, finishTime: 0 } }
      );
    });

    it('rejects invalid process type', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1,
        process: 99999,
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Invalid process');
    });

    it('rejects when recipes is zero', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1,
        process: 45,
        recipes: 0,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1,
        process: 45,
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1,
        process: 45,
        recipes: 1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when required vars are missing', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsStart', {
        caller_crew: CREW_1,
        processor: REFINERY
        // missing process, recipes, origin, destination
      });

      expect(res.status).to.equal(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ProcessProductsFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ProcessProductsFinish', function () {
    it('finishes processing when time has passed', async function () {
      // Set processor to RUNNING with past finishTime
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: {
          status: Processor.STATUSES.RUNNING,
          runningProcess: 45,
          recipes: 1,
          outputProduct: 56,
          finishTime: pastTime,
          destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
          destinationSlot: 1
        }}
      );

      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1
      });

      expect(res.status).to.equal(200);

      // Verify DB: processor is IDLE
      const proc = await mongoose.model('ProcessorComponent').findOne({
        'entity.id': REFINERY.id, 'entity.label': 5, slot: 1
      }).lean();
      expect(proc.status).to.equal(Processor.STATUSES.IDLE);
      expect(proc.runningProcess).to.equal(0);
      expect(proc.finishTime).to.equal(0);
    });

    it('rejects when processor is not RUNNING', async function () {
      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not running');
    });

    it('rejects when processing has not finished', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: Processor.STATUSES.RUNNING, finishTime: futureTime } }
      );

      const res = await postAction(server, TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');

      // Cleanup
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, finishTime: 0 } }
      );
    });

    it('rejects when caller does not own crew', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: Processor.STATUSES.RUNNING, finishTime: pastTime } }
      );

      const res = await postAction(server, WRONG_TOKEN, 'ProcessProductsFinish', {
        caller_crew: CREW_1,
        processor: REFINERY,
        processor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');

      // Cleanup
      await mongoose.model('ProcessorComponent').updateOne(
        { 'entity.id': REFINERY.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, finishTime: 0 } }
      );
    });
  });
});
