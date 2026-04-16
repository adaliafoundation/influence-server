const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const EntityLib = require('@common/lib/Entity');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE, MARKETPLACE_BLDG,
  buildActionServer, postAction, applyStubs,
  resetSeedData
} = require('@test/helpers/actionTestHelper');

describe('Actions – Marketplace', function () {
  let server;
  let sandbox;

  before(async function () {
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
    server = buildActionServer();

    // Create ExchangeComponent for the marketplace building so orders can be placed
    await mongoose.model('ExchangeComponent').findOneAndUpdate(
      { 'entity.id': MARKETPLACE_BLDG.id, 'entity.label': 5 },
      { entity: { id: MARKETPLACE_BLDG.id, label: 5 }, enabled: true },
      { upsert: true, new: true }
    );
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
  //  CreateBuyOrder
  // ═══════════════════════════════════════════════════════════════

  describe('CreateBuyOrder', function () {
    it('creates a buy order', async function () {
      const res = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 1,
        product: 1,
        amount: 100,
        price: 50
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
    });

    it('rejects when amount is zero', async function () {
      const res = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        amount: 0,
        price: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when price is zero', async function () {
      const res = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        amount: 100,
        price: 0
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when product is missing', async function () {
      const res = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        amount: 100,
        price: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('product');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        amount: 100,
        price: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CreateSellOrder
  // ═══════════════════════════════════════════════════════════════

  describe('CreateSellOrder', function () {
    it('creates a sell order', async function () {
      const res = await postAction(server, TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 1,
        product: 1,
        amount: 50,
        price: 25
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
    });

    it('rejects when amount is zero', async function () {
      const res = await postAction(server, TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        amount: 0,
        price: 25
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        amount: 50,
        price: 25
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CancelBuyOrder
  // ═══════════════════════════════════════════════════════════════

  describe('CancelBuyOrder', function () {
    it('rejects when product is missing', async function () {
      const res = await postAction(server, TOKEN, 'CancelBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        amount: 100,
        price: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('product');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CancelBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });
});
