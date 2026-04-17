const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Deposit } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, ASTEROID_1, WAREHOUSE, EXTRACTOR,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy, createEmptyLot, createSampledDeposit,
  createUnscannedAsteroid
} = require('@test/helpers/actionTestHelper');

describe('Actions – Deposit sampling', function () {
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
  //  SampleDepositStart
  // ═══════════════════════════════════════════════════════════════

  describe('SampleDepositStart', function () {
    const EMPTY_LOT = { id: (11 * 4294967296) + 1, label: 4 };

    before(async function () {
      await createEmptyLot(1, 11);
    });

    it('starts sampling and creates deposit with SAMPLING status', async function () {
      const res = await postAction(server, TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        lot: EMPTY_LOT,
        resource: 1,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.a('number');
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );

      const depositId = res.body.event.returnValues.deposit.id;
      expect(depositId).to.be.greaterThan(100000000);

      // Verify DB: DepositComponent created with SAMPLING status
      const deposit = await mongoose.model('DepositComponent').findOne({
        'entity.id': depositId, 'entity.label': 7
      }).lean();
      expect(deposit).to.exist;
      expect(deposit.status).to.equal(1); // Deposit.STATUSES.SAMPLING
      expect(deposit.finishTime).to.be.greaterThan(Math.floor(Date.now() / 1000));

      // Verify: core drill was consumed from origin inventory
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const coreDrills = inv.contents.find((c) => c.product === 175);
      expect(coreDrills.amount).to.equal(19); // Started with 20, used 1

      // Cleanup: remove created deposit entities and reset inventory/crew
      await mongoose.model('Entity').deleteOne({ id: depositId, label: 7 });
      await mongoose.model('DepositComponent').deleteOne({ 'entity.id': depositId, 'entity.label': 7 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': depositId, 'entity.label': 7 });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': depositId, 'entity.label': 7 });
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2, 'contents.product': 175 },
        { $set: { 'contents.$.amount': 20 } }
      );
      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when lot is missing', async function () {
      const res = await postAction(server, TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        resource: 1,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('lot');
    });

    it('rejects when resource is missing', async function () {
      const res = await postAction(server, TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        lot: EMPTY_LOT,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('resource');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        lot: EMPTY_LOT,
        resource: 1,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        lot: EMPTY_LOT,
        resource: 1,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when asteroid is not resource-scanned', async function () {
      // Create an unscanned asteroid (scanStatus=0)
      const asteroidId = 500;
      await createUnscannedAsteroid(asteroidId);
      // Create a lot on that asteroid
      const lotOnUnscanned = await createEmptyLot(asteroidId, 11);

      const res = await postAction(server, TOKEN, 'SampleDepositStart', {
        caller_crew: CREW_1,
        lot: lotOnUnscanned,
        resource: 1,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('resource-scanned');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  SampleDepositFinish
  // ═══════════════════════════════════════════════════════════════

  describe('SampleDepositFinish', function () {
    async function createDepositForFinish(id, { status, finishTime }) {
      const uuid = EntityLib.toUuid(id, 7);
      await mongoose.model('Entity').updateOne(
        { uuid },
        { $setOnInsert: { id, label: 7, uuid } },
        { upsert: true }
      );
      await mongoose.model('DepositComponent').findOneAndUpdate(
        { 'entity.id': id, 'entity.label': 7 },
        {
          entity: { id, label: 7 },
          resource: 1,
          status,
          initialYield: 0,
          remainingYield: 0,
          yieldEff: 0,
          finishTime
        },
        { upsert: true, new: true }
      );
      await mongoose.model('ControlComponent').findOneAndUpdate(
        { 'entity.id': id, 'entity.label': 7 },
        { entity: { id, label: 7 }, controller: { id: 1, label: 1 } },
        { upsert: true, new: true }
      );
    }

    it('finishes sampling and sets deposit to SAMPLED with yield', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createDepositForFinish(601, { status: 1, finishTime: pastTime });

      const res = await postAction(server, TOKEN, 'SampleDepositFinish', {
        caller_crew: CREW_1,
        deposit: { id: 601 }
      });

      expect(res.status).to.equal(200);

      // Verify DB: deposit is now SAMPLED
      const deposit = await mongoose.model('DepositComponent').findOne({
        'entity.id': 601, 'entity.label': 7
      }).lean();
      expect(deposit.status).to.equal(2); // Deposit.STATUSES.SAMPLED
      expect(deposit.initialYield).to.be.greaterThan(0);
    });

    it('rejects when deposit is not SAMPLING', async function () {
      await createDepositForFinish(602, { status: 2, finishTime: 0 });

      const res = await postAction(server, TOKEN, 'SampleDepositFinish', {
        caller_crew: CREW_1,
        deposit: { id: 602 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when sampling has not finished', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await createDepositForFinish(603, { status: 1, finishTime: futureTime });

      const res = await postAction(server, TOKEN, 'SampleDepositFinish', {
        caller_crew: CREW_1,
        deposit: { id: 603 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');
    });

    it('rejects when caller does not control crew', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createDepositForFinish(604, { status: 1, finishTime: pastTime });

      const res = await postAction(server, WRONG_TOKEN, 'SampleDepositFinish', {
        caller_crew: CREW_1,
        deposit: { id: 604 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  SampleDepositImprove
  // ═══════════════════════════════════════════════════════════════

  describe('SampleDepositImprove', function () {
    const EMPTY_LOT = { id: (11 * 4294967296) + 1, label: 4 };

    it('improves a SAMPLED deposit back to SAMPLING', async function () {
      const deposit = await createSampledDeposit(701, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, TOKEN, 'SampleDepositImprove', {
        caller_crew: CREW_1,
        deposit,
        lot: EMPTY_LOT,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );

      // Verify DB: deposit is back to SAMPLING
      const dep = await mongoose.model('DepositComponent').findOne({
        'entity.id': 701, 'entity.label': 7
      }).lean();
      expect(dep.status).to.equal(1); // Deposit.STATUSES.SAMPLING
      expect(dep.finishTime).to.be.greaterThan(Math.floor(Date.now() / 1000));

      // Cleanup: reset crew readyAt and restore core drill count
      await setCrewBusy(CREW_1.id, 0);
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2, 'contents.product': 175 },
        { $set: { 'contents.$.amount': 20 } }
      );
    });

    it('rejects when deposit is not SAMPLED', async function () {
      // Create a deposit with SAMPLING status (not SAMPLED)
      const uuid = EntityLib.toUuid(702, 7);
      await mongoose.model('Entity').updateOne(
        { uuid },
        { $setOnInsert: { id: 702, label: 7, uuid } },
        { upsert: true }
      );
      await mongoose.model('DepositComponent').findOneAndUpdate(
        { 'entity.id': 702, 'entity.label': 7 },
        {
          entity: { id: 702, label: 7 },
          resource: 1,
          status: 1, // SAMPLING, not SAMPLED
          initialYield: 0,
          remainingYield: 0,
          yieldEff: 0,
          finishTime: 0
        },
        { upsert: true, new: true }
      );
      await mongoose.model('ControlComponent').findOneAndUpdate(
        { 'entity.id': 702, 'entity.label': 7 },
        { entity: { id: 702, label: 7 }, controller: { id: 1, label: 1 } },
        { upsert: true, new: true }
      );

      const res = await postAction(server, TOKEN, 'SampleDepositImprove', {
        caller_crew: CREW_1,
        deposit: { id: 702 },
        lot: EMPTY_LOT,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const deposit = await createSampledDeposit(703, { resource: 1 });

      const res = await postAction(server, TOKEN, 'SampleDepositImprove', {
        caller_crew: CREW_1,
        deposit,
        lot: EMPTY_LOT,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when caller does not control crew', async function () {
      const deposit = await createSampledDeposit(704, { resource: 1 });

      const res = await postAction(server, WRONG_TOKEN, 'SampleDepositImprove', {
        caller_crew: CREW_1,
        deposit,
        lot: EMPTY_LOT,
        origin: WAREHOUSE,
        origin_slot: 2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });
});
