const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Extractor } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, EXTRACTOR, WAREHOUSE,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy, setBuildingStatus, createSampledDeposit
} = require('@test/helpers/actionTestHelper');

describe('Actions – Extraction', function () {
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
  //  ExtractResourceStart
  // ═══════════════════════════════════════════════════════════════

  describe('ExtractResourceStart', function () {
    // The Cairo contract requires extractor and deposit to share a lot;
    // EXTRACTOR building 2 sits at lotIndex 2 on asteroid 1.
    const EXTRACTOR_LOT_ID = (2 * 4294967296) + 1;

    it('starts extraction on a sampled deposit', async function () {
      const deposit = await createSampledDeposit(500, {
        resource: 1, remainingYield: 5000, lotId: EXTRACTOR_LOT_ID
      });

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 1000
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );
      expect(res.body.event.returnValues.yield).to.equal(1000);

      // Verify DB: Extractor is RUNNING
      const ext = await mongoose.model('ExtractorComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1
      }).lean();
      expect(ext.status).to.equal(Extractor.STATUSES.RUNNING);
      expect(ext.yield).to.equal(1000);
      expect(ext.finishTime).to.be.greaterThan(0);

      // Verify: deposit remainingYield decreased
      const dep = await mongoose.model('DepositComponent').findOne({
        'entity.id': 500, 'entity.label': 7
      }).lean();
      expect(dep.remainingYield).to.equal(4000);

      // Cleanup: reset extractor to idle and crew to ready
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, yield: 0, finishTime: 0 } }
      );
      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when deposit is not sampled', async function () {
      // Create an UNDISCOVERED deposit
      await createSampledDeposit(501);
      await mongoose.model('DepositComponent').updateOne(
        { 'entity.id': 501, 'entity.label': 7 },
        { $set: { status: 0 } } // UNDISCOVERED
      );

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit: { id: 501, label: 7 },
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('sampled');
    });

    it('rejects when yield exceeds remaining', async function () {
      const deposit = await createSampledDeposit(502, { remainingYield: 100 });

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 200
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('exceeds');
    });

    it('rejects when yield is zero or negative', async function () {
      const deposit = await createSampledDeposit(503);

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 0
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const deposit = await createSampledDeposit(504);

      const res = await postAction(server, WRONG_TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when extractor slot is not idle', async function () {
      // Set extractor slot 1 to RUNNING
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 1 } }
      );
      const deposit = await createSampledDeposit(510);

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('idle');

      // Cleanup
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0 } }
      );
    });

    it('rejects when extractor building is not operational', async function () {
      // Set building status to PLANNED (1)
      await setBuildingStatus(EXTRACTOR.id, 1);
      const deposit = await createSampledDeposit(511);

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('operational');

      // Cleanup: restore to OPERATIONAL (3)
      await setBuildingStatus(EXTRACTOR.id, 3);
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);
      const deposit = await createSampledDeposit(505);

      const res = await postAction(server, TOKEN, 'ExtractResourceStart', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1,
        deposit,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        destination_slot: 1,
        yield: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ExtractResourceFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ExtractResourceFinish', function () {
    it('finishes extraction when time has passed', async function () {
      // Set extractor to RUNNING with past finishTime
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: {
          status: Extractor.STATUSES.RUNNING,
          outputProduct: 1,
          yield: 500,
          finishTime: pastTime,
          destination: { id: WAREHOUSE.id, label: WAREHOUSE.label },
          destinationSlot: 1
        }}
      );
      // Set some phantom reservations on the destination inventory
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { reservedMass: 9999, reservedVolume: 9999 } }
      );

      const res = await postAction(server, TOKEN, 'ExtractResourceFinish', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1
      });

      expect(res.status).to.equal(200);

      // Verify DB: extractor is IDLE
      const ext = await mongoose.model('ExtractorComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1
      }).lean();
      expect(ext.status).to.equal(Extractor.STATUSES.IDLE);
      expect(ext.finishTime).to.equal(0);

      // Verify: phantom reservations cleared
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1
      }).lean();
      expect(inv.reservedMass).to.equal(0);
      expect(inv.reservedVolume).to.equal(0);
    });

    it('rejects when extractor is not RUNNING', async function () {
      // Extractor slot 1 is IDLE after previous test
      const res = await postAction(server, TOKEN, 'ExtractResourceFinish', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not running');
    });

    it('rejects when extraction has not finished', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: Extractor.STATUSES.RUNNING, finishTime: futureTime } }
      );

      const res = await postAction(server, TOKEN, 'ExtractResourceFinish', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');

      // Cleanup
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, finishTime: 0 } }
      );
    });

    it('rejects when caller does not own crew', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: Extractor.STATUSES.RUNNING, finishTime: pastTime } }
      );

      const res = await postAction(server, WRONG_TOKEN, 'ExtractResourceFinish', {
        caller_crew: CREW_1,
        extractor: EXTRACTOR,
        extractor_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');

      // Cleanup
      await mongoose.model('ExtractorComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 1 },
        { $set: { status: 0, finishTime: 0 } }
      );
    });
  });
});
