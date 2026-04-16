const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE, EXTRACTOR,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy, createDeliveryEntity
} = require('@test/helpers/actionTestHelper');

describe('Actions – Delivery operations', function () {
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
  //  SendDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('SendDelivery', function () {
    it('creates a delivery from warehouse to extractor', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
      const rv = res.body.event.returnValues;
      expect(rv.delivery).to.have.property('id');
      expect(rv.delivery.id).to.be.greaterThan(100000000);
    });

    it('rejects when products array is empty', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: []
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('non-empty');
    });

    it('rejects when origin is missing', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('origin');
    });

    it('rejects when destination is missing', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('dest');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  PackageDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('PackageDelivery', function () {
    it('creates a packaged delivery', async function () {
      const res = await postAction(server, TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 50 }],
        price: 0
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
    });

    it('rejects when products is empty', async function () {
      const res = await postAction(server, TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: []
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('non-empty');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 50 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  AcceptDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('AcceptDelivery', function () {
    afterEach(async function () {
      await mongoose.model('DeliveryComponent').deleteMany({ 'entity.id': { $gte: 200 } });
      await mongoose.model('ControlComponent').deleteMany({ 'entity.id': { $gte: 200 }, 'entity.label': 9 });
      await mongoose.model('Entity').deleteMany({ id: { $gte: 200 }, label: 9 });
    });

    it('accepts a PACKAGED delivery and transitions to SENT', async function () {
      await createDeliveryEntity(200, { status: 3 });

      const res = await postAction(server, TOKEN, 'AcceptDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      const updated = await mongoose.model('DeliveryComponent').findOne({ 'entity.id': 200 });
      expect(updated.status).to.equal(4); // SENT
      expect(updated.finishTime).to.be.greaterThan(0);
    });

    it('rejects when delivery is not PACKAGED', async function () {
      await createDeliveryEntity(201, { status: 4, finishTime: Math.floor(Date.now() / 1000) + 600 });

      const res = await postAction(server, TOKEN, 'AcceptDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 201, label: 9 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when caller does not control crew', async function () {
      await createDeliveryEntity(202, { status: 3 });

      const res = await postAction(server, WRONG_TOKEN, 'AcceptDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 202, label: 9 }
      });

      expect(res.status).to.equal(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ReceiveDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('ReceiveDelivery', function () {
    afterEach(async function () {
      await mongoose.model('DeliveryComponent').deleteMany({ 'entity.id': { $gte: 200 } });
      await mongoose.model('ControlComponent').deleteMany({ 'entity.id': { $gte: 200 }, 'entity.label': 9 });
      await mongoose.model('Entity').deleteMany({ id: { $gte: 200 }, label: 9 });
    });

    it('receives a SENT delivery that has finished', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 120;
      await createDeliveryEntity(200, { status: 4, finishTime: pastTime });

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      const updated = await mongoose.model('DeliveryComponent').findOne({ 'entity.id': 200 });
      expect(updated.status).to.equal(2); // COMPLETE
    });

    it('rejects when delivery is not SENT', async function () {
      await createDeliveryEntity(201, { status: 3 });

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 201, label: 9 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when delivery has not finished yet', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await createDeliveryEntity(202, { status: 4, finishTime: futureTime });

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 202, label: 9 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');
    });

    it('rejects when caller does not control crew', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 120;
      await createDeliveryEntity(203, { status: 4, finishTime: pastTime });

      const res = await postAction(server, WRONG_TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 203, label: 9 }
      });

      expect(res.status).to.equal(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CancelDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('CancelDelivery', function () {
    afterEach(async function () {
      await mongoose.model('DeliveryComponent').deleteMany({ 'entity.id': { $gte: 200 } });
      await mongoose.model('ControlComponent').deleteMany({ 'entity.id': { $gte: 200 }, 'entity.label': 9 });
      await mongoose.model('Entity').deleteMany({ id: { $gte: 200 }, label: 9 });
    });

    it('cancels a PACKAGED delivery and transitions to COMPLETE', async function () {
      await createDeliveryEntity(200, { status: 3 });

      const res = await postAction(server, TOKEN, 'CancelDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      const updated = await mongoose.model('DeliveryComponent').findOne({ 'entity.id': 200 });
      expect(updated.status).to.equal(2); // COMPLETE
    });

    it('rejects when delivery is not PACKAGED', async function () {
      await createDeliveryEntity(201, { status: 4, finishTime: Math.floor(Date.now() / 1000) + 600 });

      const res = await postAction(server, TOKEN, 'CancelDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 201, label: 9 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('status');
    });

    it('rejects when caller does not control crew', async function () {
      await createDeliveryEntity(202, { status: 3 });

      const res = await postAction(server, WRONG_TOKEN, 'CancelDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 202, label: 9 }
      });

      expect(res.status).to.equal(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  DumpDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('DumpDelivery', function () {
    it('dumps products successfully', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when products array is empty', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        products: []
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('non-empty');
    });

    it('rejects when origin is missing', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('origin');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
    });
  });
});
