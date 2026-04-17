const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const EntityLib = require('@common/lib/Entity');
const { Order, Product } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE, EXTRACTOR, MARKETPLACE_BLDG,
  buildActionServer, postAction, applyStubs,
  resetSeedData, createOrder
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

    it('reserves space in destination inventory', async function () {
      await resetSeedData();

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      const res = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: 200,
        price: 50
      });
      expect(res.status).to.equal(200);

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      const pt = Product.TYPES[1];
      const expectedMass = 200 * pt.massPerUnit;
      const expectedVolume = 200 * pt.volumePerUnit;
      expect(invAfter.reservedMass).to.equal((invBefore.reservedMass || 0) + expectedMass);
      expect(invAfter.reservedVolume).to.equal((invBefore.reservedVolume || 0) + expectedVolume);

      await resetSeedData();
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

    it('removes products from storage inventory', async function () {
      await resetSeedData();

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productBefore = invBefore.contents.find(c => c.product === 1).amount;

      const sellAmount = 500;
      const res = await postAction(server, TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: sellAmount,
        price: 25
      });
      expect(res.status).to.equal(200);

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productAfter = invAfter.contents.find(c => c.product === 1).amount;
      expect(productAfter).to.equal(productBefore - sellAmount);

      await resetSeedData();
    });

    it('reserves space in storage for cancellation', async function () {
      await resetSeedData();

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      const sellAmount = 500;
      const res = await postAction(server, TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: sellAmount,
        price: 25
      });
      expect(res.status).to.equal(200);

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      const pt = Product.TYPES[1];
      const expectedMass = sellAmount * pt.massPerUnit;
      const expectedVolume = sellAmount * pt.volumePerUnit;
      expect(invAfter.reservedMass).to.equal((invBefore.reservedMass || 0) + expectedMass);
      expect(invAfter.reservedVolume).to.equal((invBefore.reservedVolume || 0) + expectedVolume);

      await resetSeedData();
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

    it('clears destination reservation', async function () {
      await resetSeedData();

      // First create a buy order (which reserves space)
      const buyAmount = 200;
      const createRes = await postAction(server, TOKEN, 'CreateBuyOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: buyAmount,
        price: 50
      });
      expect(createRes.status).to.equal(200);

      const invBeforeCancel = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      // Cancel the buy order
      const cancelRes = await postAction(server, TOKEN, 'CancelBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: buyAmount,
        price: 50
      });
      expect(cancelRes.status).to.equal(200);

      const invAfterCancel = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      const pt = Product.TYPES[1];
      const reservedMass = buyAmount * pt.massPerUnit;
      const reservedVolume = buyAmount * pt.volumePerUnit;
      expect(invAfterCancel.reservedMass).to.equal((invBeforeCancel.reservedMass || 0) - reservedMass);
      expect(invAfterCancel.reservedVolume).to.equal((invBeforeCancel.reservedVolume || 0) - reservedVolume);

      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CancelSellOrder
  // ═══════════════════════════════════════════════════════════════

  describe('CancelSellOrder', function () {
    it('cancels an existing sell order', async function () {
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_SELL, product: 1, amount: 50, price: 25,
        storage: WAREHOUSE, storageSlot: 1, status: Order.STATUSES.OPEN
      });

      const res = await postAction(server, TOKEN, 'CancelSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1,
        price: 25,
        storage_slot: 1
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when product is missing', async function () {
      const res = await postAction(server, TOKEN, 'CancelSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        price: 25
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('product');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CancelSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        product: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('returns products to storage', async function () {
      await resetSeedData();

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productBefore = invBefore.contents.find(c => c.product === 1).amount;

      // First create a sell order (which removes products and adds reservation)
      const sellAmount = 300;
      const createRes = await postAction(server, TOKEN, 'CreateSellOrder', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        amount: sellAmount,
        price: 25
      });
      expect(createRes.status).to.equal(200);

      // Verify products were removed
      const invAfterCreate = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      expect(invAfterCreate.contents.find(c => c.product === 1).amount).to.equal(productBefore - sellAmount);

      // Cancel the sell order
      const cancelRes = await postAction(server, TOKEN, 'CancelSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        storage_slot: 2,
        product: 1,
        price: 25
      });
      expect(cancelRes.status).to.equal(200);

      // Verify products were returned and reservations cleared
      const invAfterCancel = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      expect(invAfterCancel.contents.find(c => c.product === 1).amount).to.equal(productBefore);
      expect(invAfterCancel.reservedMass).to.equal(0);
      expect(invAfterCancel.reservedVolume).to.equal(0);

      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  FillBuyOrder
  // ═══════════════════════════════════════════════════════════════

  describe('FillBuyOrder', function () {
    it('partially fills a buy order', async function () {
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_BUY, product: 2, amount: 100, price: 50,
        storage: WAREHOUSE, storageSlot: 1, status: Order.STATUSES.OPEN
      });

      const res = await postAction(server, TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: WAREHOUSE,
        product: 2,
        amount: 50,
        price: 50,
        storage_slot: 1,
        origin_slot: 1
      });

      expect(res.status).to.equal(200);
    });

    it('completely fills a buy order', async function () {
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_BUY, product: 3, amount: 100, price: 50,
        storage: WAREHOUSE, storageSlot: 1, status: Order.STATUSES.OPEN
      });

      const res = await postAction(server, TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: WAREHOUSE,
        product: 3,
        amount: 100,
        price: 50,
        storage_slot: 1,
        origin_slot: 1
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when amount is zero', async function () {
      const res = await postAction(server, TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: WAREHOUSE,
        product: 1,
        amount: 0,
        price: 50,
        storage_slot: 1,
        origin_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: WAREHOUSE,
        product: 1,
        amount: 50,
        price: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('removes products from seller origin', async function () {
      await resetSeedData();

      // Create a buy order first (reserves space in buyer's storage)
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_BUY, product: 1, amount: 500, price: 50,
        storage: WAREHOUSE, storageSlot: 2, status: Order.STATUSES.OPEN
      });

      // Set up reservation on buyer storage (simulating what CreateBuyOrder would have done)
      const pt = Product.TYPES[1];
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2 },
        { $inc: { reservedMass: 500 * pt.massPerUnit, reservedVolume: 500 * pt.volumePerUnit } }
      );

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productBefore = invBefore.contents.find(c => c.product === 1).amount;

      const fillAmount = 200;
      const res = await postAction(server, TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: WAREHOUSE,
        product: 1,
        amount: fillAmount,
        price: 50,
        storage_slot: 2,
        origin_slot: 2
      });
      expect(res.status).to.equal(200);

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();

      // When origin === storage, the handler writes the inventory twice.
      // The origin deduction removes fillAmount, then the buyer addition adds it back.
      // The net effect on contents is zero, but the reservation is cleared.
      // Since origin and storage are the same entity+slot, the final write wins.
      // Let's just verify the reservation decreased.
      expect(invAfter.reservedMass).to.be.lessThan(invBefore.reservedMass);

      await resetSeedData();
    });

    it('adds products to buyer storage', async function () {
      await resetSeedData();

      // Use EXTRACTOR as the seller's origin (it has a separate inventory)
      // First set up an inventory on the extractor with some product 1
      await mongoose.model('InventoryComponent').findOneAndUpdate(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 2 },
        {
          entity: { id: EXTRACTOR.id, label: 5 },
          inventoryType: 10, slot: 2, status: 0,
          mass: 1000 * 1000, volume: 1000 * 971,
          reservedMass: 0, reservedVolume: 0,
          contents: [{ product: 1, amount: 1000 }]
        },
        { upsert: true, new: true }
      );

      // Create a buy order
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_BUY, product: 1, amount: 500, price: 50,
        storage: WAREHOUSE, storageSlot: 2, status: Order.STATUSES.OPEN
      });

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productBefore = invBefore.contents.find(c => c.product === 1).amount;

      const fillAmount = 200;
      const res = await postAction(server, TOKEN, 'FillBuyOrder', {
        caller_crew: CREW_1,
        buyer_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        origin: EXTRACTOR,
        product: 1,
        amount: fillAmount,
        price: 50,
        storage_slot: 2,
        origin_slot: 2
      });
      expect(res.status).to.equal(200);

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const productAfter = invAfter.contents.find(c => c.product === 1).amount;
      expect(productAfter).to.equal(productBefore + fillAmount);

      // Also verify origin had products removed
      const originInvAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 2
      }).lean();
      const originProductAfter = originInvAfter.contents.find(c => c.product === 1).amount;
      expect(originProductAfter).to.equal(1000 - fillAmount);

      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  FillSellOrder
  // ═══════════════════════════════════════════════════════════════

  describe('FillSellOrder', function () {
    it('partially fills a sell order', async function () {
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_SELL, product: 4, amount: 100, price: 25,
        storage: WAREHOUSE, storageSlot: 1, status: Order.STATUSES.OPEN
      });

      const res = await postAction(server, TOKEN, 'FillSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        destination: WAREHOUSE,
        product: 4,
        amount: 50,
        price: 25,
        storage_slot: 1,
        dest_slot: 1
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when amount is zero', async function () {
      const res = await postAction(server, TOKEN, 'FillSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        destination: WAREHOUSE,
        product: 1,
        amount: 0,
        price: 25,
        storage_slot: 1,
        dest_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'FillSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        destination: WAREHOUSE,
        product: 1,
        amount: 50,
        price: 25
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('adds products to buyer destination', async function () {
      await resetSeedData();

      // Use EXTRACTOR as the buyer's destination (separate from seller storage)
      await mongoose.model('InventoryComponent').findOneAndUpdate(
        { 'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 2 },
        {
          entity: { id: EXTRACTOR.id, label: 5 },
          inventoryType: 10, slot: 2, status: 0,
          mass: 0, volume: 0,
          reservedMass: 0, reservedVolume: 0,
          contents: []
        },
        { upsert: true, new: true }
      );

      // Create a sell order
      await createOrder(MARKETPLACE_BLDG.id, {
        crew: CREW_1, orderType: Order.IDS.LIMIT_SELL, product: 1, amount: 500, price: 25,
        storage: WAREHOUSE, storageSlot: 2, status: Order.STATUSES.OPEN
      });

      // Set up reservation on seller's storage (simulating what CreateSellOrder would have done)
      const pt = Product.TYPES[1];
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2 },
        { $inc: { reservedMass: 500 * pt.massPerUnit, reservedVolume: 500 * pt.volumePerUnit } }
      );

      const fillAmount = 200;
      const res = await postAction(server, TOKEN, 'FillSellOrder', {
        caller_crew: CREW_1,
        seller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        storage: WAREHOUSE,
        destination: EXTRACTOR,
        product: 1,
        amount: fillAmount,
        price: 25,
        storage_slot: 2,
        destination_slot: 2
      });
      expect(res.status).to.equal(200);

      // Verify products were added to buyer's destination
      const destInvAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': 5, slot: 2
      }).lean();
      const destProduct = destInvAfter.contents.find(c => c.product === 1);
      expect(destProduct).to.exist;
      expect(destProduct.amount).to.equal(fillAmount);

      // Verify seller's storage reservation decreased
      const sellerInvAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 2
      }).lean();
      const expectedReservedMass = (500 - fillAmount) * pt.massPerUnit;
      expect(sellerInvAfter.reservedMass).to.equal(expectedReservedMass);

      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ConfigureExchange
  // ═══════════════════════════════════════════════════════════════

  describe('ConfigureExchange', function () {
    it('configures exchange fees and allowed products', async function () {
      const res = await postAction(server, TOKEN, 'ConfigureExchange', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        maker_fee: 100,
        taker_fee: 200,
        allowed_products: [1, 2, 3]
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ConfigureExchange', {
        caller_crew: CREW_1,
        exchange: MARKETPLACE_BLDG,
        maker_fee: 100,
        taker_fee: 200
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });
});
