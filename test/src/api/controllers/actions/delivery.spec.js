const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE, EXTRACTOR, TANK_FARM, SHIP_1,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setBuildingStatus, setInventoryStatus,
  setCrewBusy, createDeliveryEntity
} = require('@test/helpers/actionTestHelper');

// Seed data inventory contents (warehouse slot 2 = Warehouse Storage):
//   product 44 (Cement): 15,000,000
//   product 69 (Steel Beam): 10,000,000
//   product 70 (Steel Sheet): 12,000,000
//   product 1 (Water): 5,000,000
// Extractor slot 1 (Extractor Site):
//   product 44 (Cement): 250,000
//   product 69 (Steel Beam): 300,000

describe('Actions – Delivery operations', function () {
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
    // Reset seed data so inventory modifications from one test don't affect the next
    await resetSeedData();
  });

  after(function () {
    sandbox.restore();
  });

  // ═══════════════════════════════════════════════════════════════
  //  SendDelivery
  // ═══════════════════════════════════════════════════════════════

  describe('SendDelivery', function () {
    it('creates a delivery and subtracts from origin inventory', async function () {
      // Warehouse slot 2 has 15,000,000 Cement (product 44)
      // Tank farm slot 2 (Fluids Storage) has plenty of free capacity
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 1, amount: 1000 }]
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
      const rv = res.body.event.returnValues;
      expect(rv.delivery).to.have.property('id');
      expect(rv.delivery.id).to.be.greaterThan(100000000);

      // Origin inventory should be reduced (Water was 5,000,000)
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const water = inv.contents.find((c) => c.product === 1);
      expect(water.amount).to.equal(5000000 - 1000);

      // Mass and volume should be recomputed (not stale)
      expect(inv.mass).to.be.greaterThan(0);
      expect(inv.mass).to.be.lessThan(59125200000); // less than original seed value
    });

    it('removes product from origin when entire amount is sent', async function () {
      // Send all 50,000 Gold (product 61) from warehouse slot 2
      // Tank farm slot 2 has plenty of capacity
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 61, amount: 50000 }]
      });

      expect(res.status).to.equal(200);

      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const gold = inv.contents.find((c) => c.product === 61);
      expect(gold).to.be.undefined;
    });

    it('reserves space at destination inventory', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 1, amount: 1000 }]
      });

      expect(res.status).to.equal(200);

      // Destination inventory should have reservedMass/reservedVolume increased
      // Water: massPerUnit=1000, volumePerUnit=971; 1000 units => mass=1000000, volume=971000
      const destInv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': TANK_FARM.id, 'entity.label': TANK_FARM.label, slot: 2
      }).lean();
      expect(destInv.reservedMass).to.equal(1000 * 1000);
      expect(destInv.reservedVolume).to.equal(1000 * 971);
    });

    it('rejects when origin has insufficient product', async function () {
      // Warehouse slot 2 has 5,000,000 Water — request more
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 1, amount: 5000001 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient');
      expect(res.body.error).to.include('Water');
    });

    it('rejects when origin does not have the product at all', async function () {
      // Product 170 (Hydrogen Propellant) is not in warehouse slot 2
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 170, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient');
    });

    it('rejects when destination inventory would exceed mass capacity', async function () {
      // Ship cargo (type 16, Medium Cargo Hold) has 2B mass capacity, currently
      // at 45M. Sending 2M Cement units (2B mass) overflows by 45M.
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: SHIP_1.id, label: SHIP_1.label },
        dest_slot: 2,
        products: [{ product: 44, amount: 2000000 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('mass');
    });

    it('rejects when destination inventory would exceed volume capacity', async function () {
      // Warehouse storage (type 10) has 75B volume capacity, currently at ~92%.
      // Sending 500,000 Hydrogen Propellant (vol 13300/unit = 6.65B) overflows volume
      // but not mass (500M << 1441B free).
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: TANK_FARM.id, label: TANK_FARM.label },
        origin_slot: 2,
        dest: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        dest_slot: 2,
        products: [{ product: 170, amount: 500000 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('volume');
    });

    it('rejects when origin inventory slot does not exist', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 99,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Origin inventory not found');
    });

    it('rejects when destination inventory slot does not exist', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 99,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Destination inventory not found');
    });

    it('rejects when destination inventory is unavailable', async function () {
      // Extractor site (slot 1) has status UNAVAILABLE (0) in seed data
      // Make it available first, then set building to UNDER_CONSTRUCTION and lock it
      await setInventoryStatus(EXTRACTOR.id, EXTRACTOR.label, 1, 0); // ensure UNAVAILABLE
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not available');
    });

    it('rejects wrong material type for construction site', async function () {
      // Set extractor to PLANNED with site inventory AVAILABLE
      await setBuildingStatus(EXTRACTOR.id, 1); // PLANNED
      await setInventoryStatus(EXTRACTOR.id, EXTRACTOR.label, 1, 1); // AVAILABLE

      // Extractor requires: Cement(44), Steel Beam(69), PAN Fabric(125), Fluids Module(237), Power Module(243)
      // Water (product 1) is NOT a required material
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 1, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not a required construction material');
    });

    it('rejects excess material for construction site', async function () {
      // Set extractor to PLANNED with site inventory AVAILABLE and empty contents
      await setBuildingStatus(EXTRACTOR.id, 1); // PLANNED
      await setInventoryStatus(EXTRACTOR.id, EXTRACTOR.label, 1, 1); // AVAILABLE

      // Extractor needs 250,000 Cement. Site already has 250,000 from seed data.
      // Sending even 1 more exceeds the requirement.
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 1 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Too much');
      expect(res.body.error).to.include('Cement');
    });

    it('rejects when products array is empty', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
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
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('origin');
    });

    it('rejects when destination is missing', async function () {
      const res = await postAction(server, TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('dest');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'SendDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 44, amount: 100 }]
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
        origin_slot: 2,
        dest: { id: TANK_FARM.id, label: TANK_FARM.label },
        dest_slot: 2,
        products: [{ product: 44, amount: 100 }]
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
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 50 }],
        price: 0
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
    });

    it('removes products from origin inventory', async function () {
      // Warehouse slot 2 has 15,000,000 Cement (product 44)
      const res = await postAction(server, TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 500 }],
        price: 0
      });

      expect(res.status).to.equal(200);

      // Origin inventory should have Cement reduced by 500
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const cement = inv.contents.find((c) => c.product === 44);
      expect(cement.amount).to.equal(15000000 - 500);
    });

    it('rejects when products is empty', async function () {
      const res = await postAction(server, TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
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
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 50 }]
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
      await createDeliveryEntity(200, { status: 3, contents: [{ product: 44, amount: 100 }] });

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

    it('receives a delivery and adds products to destination inventory', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 120;
      await createDeliveryEntity(200, {
        status: 4,
        finishTime: pastTime,
        contents: [{ product: 44, amount: 5000 }],
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label }
      });

      // Record extractor inventory before
      const before = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': EXTRACTOR.label, slot: 1
      }).lean();
      const cementBefore = before.contents.find((c) => c.product === 44).amount;

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      const updated = await mongoose.model('DeliveryComponent').findOne({ 'entity.id': 200 });
      expect(updated.status).to.equal(2); // COMPLETE

      // Destination inventory should have received the products
      const after = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': EXTRACTOR.label, slot: 1
      }).lean();
      const cementAfter = after.contents.find((c) => c.product === 44).amount;
      expect(cementAfter).to.equal(cementBefore + 5000);
    });

    it('adds a new product to destination if it did not exist before', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 120;
      // Product 1 (Water) is not in extractor slot 1
      await createDeliveryEntity(200, {
        status: 4,
        finishTime: pastTime,
        contents: [{ product: 1, amount: 200 }],
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label }
      });

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);

      const after = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': EXTRACTOR.label, slot: 1
      }).lean();
      const water = after.contents.find((c) => c.product === 1);
      expect(water).to.not.be.undefined;
      expect(water.amount).to.equal(200);
    });

    it('clears destination reservations after receive', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 120;

      // First, set some reservations on the destination inventory
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': EXTRACTOR.id, 'entity.label': EXTRACTOR.label, slot: 1 },
        { $set: { reservedMass: 5000000, reservedVolume: 5650000 } }
      );

      await createDeliveryEntity(200, {
        status: 4,
        finishTime: pastTime,
        contents: [{ product: 44, amount: 5000 }],
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label }
      });

      const res = await postAction(server, TOKEN, 'ReceiveDelivery', {
        caller_crew: CREW_1,
        delivery: { id: 200, label: 9 }
      });

      expect(res.status).to.equal(200);

      // Destination inventory should have reservedMass and reservedVolume cleared to 0
      const destInv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': EXTRACTOR.id, 'entity.label': EXTRACTOR.label, slot: 1
      }).lean();
      expect(destInv.reservedMass).to.equal(0);
      expect(destInv.reservedVolume).to.equal(0);
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

    it('returns products to origin inventory on cancel', async function () {
      // First package a delivery (which removes products from origin)
      const pkgRes = await postAction(server, TOKEN, 'PackageDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        dest: { id: EXTRACTOR.id, label: EXTRACTOR.label },
        dest_slot: 1,
        products: [{ product: 44, amount: 1000 }],
        price: 0
      });
      expect(pkgRes.status).to.equal(200);

      // Origin should be reduced after packaging
      const invAfterPkg = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const cementAfterPkg = invAfterPkg.contents.find((c) => c.product === 44);
      expect(cementAfterPkg.amount).to.equal(15000000 - 1000);

      // Get the delivery ID from the package response
      const deliveryId = pkgRes.body.event.returnValues.delivery.id;

      // Now cancel the delivery
      const cancelRes = await postAction(server, TOKEN, 'CancelDelivery', {
        caller_crew: CREW_1,
        delivery: { id: deliveryId, label: 9 }
      });
      expect(cancelRes.status).to.equal(200);

      // Origin inventory should have products restored
      const invAfterCancel = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const cementAfterCancel = invAfterCancel.contents.find((c) => c.product === 44);
      expect(cementAfterCancel.amount).to.equal(15000000);
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
    it('dumps products and subtracts from origin inventory', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(200);

      // Cement should be reduced (was 15,000,000)
      const inv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label, slot: 2
      }).lean();
      const cement = inv.contents.find((c) => c.product === 44);
      expect(cement.amount).to.equal(15000000 - 100);
    });

    it('rejects when origin has insufficient product', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        products: [{ product: 44, amount: 99999999 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient');
    });

    it('rejects when products array is empty', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        products: []
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('non-empty');
    });

    it('rejects when origin is missing', async function () {
      const res = await postAction(server, TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('origin');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'DumpDelivery', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 2,
        products: [{ product: 44, amount: 100 }]
      });

      expect(res.status).to.equal(400);
    });
  });
});
