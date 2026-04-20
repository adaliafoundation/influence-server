const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE, EXTRACTOR,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy
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
});
