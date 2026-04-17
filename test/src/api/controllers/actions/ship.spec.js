const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Product, Ship } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, ASTEROID_2,
  WAREHOUSE, HABITAT, SPACEPORT, SHIPYARD, SHIP_1,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy
} = require('@test/helpers/actionTestHelper');

describe('Actions – Ship operations', function () {
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
  //  UndockShip
  // ═══════════════════════════════════════════════════════════════

  describe('UndockShip', function () {
    it('undocks ship from spaceport to asteroid', async function () {
      // Ship 1 is docked at spaceport (building 9)
      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify DB: ship location is now asteroid
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(loc.location.label).to.equal(3); // Asteroid

      // Restore
      await resetSeedData();
    });

    it('rejects when ship is not docked at a building', async function () {
      // First undock
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      // Clear crew busy from undock
      await setCrewBusy(CREW_1.id, 0);

      // Try undocking again — ship is at asteroid, not a building
      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not on a surface');

      // Restore
      await resetSeedData();
    });

    it('deducts propellant on powered (propulsive) launch', async function () {
      // Record propellant before
      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propBefore = invBefore.contents.find((c) => c.product === 170).amount;

      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1,
        powered: true
      });

      expect(res.status).to.equal(200);

      // Propellant should be reduced
      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfter = invAfter.contents.find((c) => c.product === 170).amount;
      expect(propAfter).to.be.lessThan(propBefore);
      expect(propAfter).to.be.greaterThan(0);

      // Mass should be reduced accordingly
      const pt = Product.TYPES[170];
      expect(invAfter.mass).to.equal(propAfter * pt.massPerUnit);

      // Restore
      await resetSeedData();
    });

    it('does not deduct propellant on non-powered launch', async function () {
      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propBefore = invBefore.contents.find((c) => c.product === 170).amount;

      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1,
        powered: false
      });

      expect(res.status).to.equal(200);

      // Propellant should be unchanged
      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfter = invAfter.contents.find((c) => c.product === 170).amount;
      expect(propAfter).to.equal(propBefore);

      // Restore
      await resetSeedData();
    });

    it('rejects powered launch when propellant is insufficient', async function () {
      // Drain the propellant tank
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1 },
        { $set: { mass: 0, volume: 0, contents: [] } }
      );

      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1,
        powered: true
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient propellant');

      // Restore
      await resetSeedData();
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('decrements dock ship count', async function () {
      // Check dock count before
      const dockBefore = await mongoose.model('DockComponent').findOne({
        'entity.id': SPACEPORT.id, 'entity.label': SPACEPORT.label
      }).lean();
      const countBefore = dockBefore.dockedShips;

      // Undock
      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      expect(res.status).to.equal(200);

      // Verify dock count decreased
      const dockAfter = await mongoose.model('DockComponent').findOne({
        'entity.id': SPACEPORT.id, 'entity.label': SPACEPORT.label
      }).lean();
      expect(dockAfter.dockedShips).to.equal(countBefore - 1);

      // Restore
      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  DockShip
  // ═══════════════════════════════════════════════════════════════

  describe('DockShip', function () {
    it('docks ship at a building', async function () {
      // Undock the ship first
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Crew must be ON the ship to dock it
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      // Now dock at spaceport
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });

      expect(res.status).to.equal(200);

      // Verify DB: ship at spaceport
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(loc.location.id).to.equal(SPACEPORT.id);

      // Restore
      await resetSeedData();
    });

    it('deducts propellant on powered (propulsive) landing', async function () {
      // Undock the ship (non-powered to preserve propellant)
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Station crew on ship
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      // Record propellant before landing
      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propBefore = invBefore.contents.find((c) => c.product === 170).amount;

      // Dock with powered landing
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label },
        powered: true
      });

      expect(res.status).to.equal(200);

      // Propellant should be reduced
      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfter = invAfter.contents.find((c) => c.product === 170).amount;
      expect(propAfter).to.be.lessThan(propBefore);
      expect(propAfter).to.be.greaterThan(0);

      // Restore
      await resetSeedData();
    });

    it('landing propellant cost is comparable to launch cost', async function () {
      // Powered launch
      const invBeforeLaunch = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propBeforeLaunch = invBeforeLaunch.contents.find((c) => c.product === 170).amount;

      let res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1,
        powered: true
      });
      expect(res.status).to.equal(200);
      await setCrewBusy(CREW_1.id, 0);

      const invAfterLaunch = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfterLaunch = invAfterLaunch.contents.find((c) => c.product === 170).amount;
      const launchCost = propBeforeLaunch - propAfterLaunch;

      // Station crew on ship for powered landing
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      const propBeforeLand = propAfterLaunch;

      res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label },
        powered: true
      });
      expect(res.status).to.equal(200);

      const invAfterLand = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfterLand = invAfterLand.contents.find((c) => c.product === 170).amount;
      const landCost = propBeforeLand - propAfterLand;

      // Landing should cost similar to (or less than) launch — same escape velocity, slightly less mass
      expect(landCost).to.be.lessThan(launchCost * 1.5);

      await resetSeedData();
    });

    it('rejects powered landing when propellant is insufficient', async function () {
      // Undock the ship (non-powered)
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Station crew on ship
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      // Drain the propellant tank
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1 },
        { $set: { mass: 0, volume: 0, contents: [] } }
      );

      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label },
        powered: true
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Insufficient propellant');

      // Restore
      await resetSeedData();
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when target is missing id or label', async function () {
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: 1 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('target');
    });

    it('rejects when ship is already docked', async function () {
      // Ship is already docked at spaceport in seed state.
      // Station crew on ship first (so crew is on ship for docking check)
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      // Try to dock again at spaceport — should fail since ship is already docked
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('already docked');

      // Restore
      await resetSeedData();
    });

    it('increments dock ship count', async function () {
      // First undock so we can dock again
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Check dock count after undock
      const dockAfterUndock = await mongoose.model('DockComponent').findOne({
        'entity.id': SPACEPORT.id, 'entity.label': SPACEPORT.label
      }).lean();
      const countAfterUndock = dockAfterUndock.dockedShips;

      // Station crew on ship
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      // Dock
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
      expect(res.status).to.equal(200);

      // Verify dock count increased
      const dockAfterDock = await mongoose.model('DockComponent').findOne({
        'entity.id': SPACEPORT.id, 'entity.label': SPACEPORT.label
      }).lean();
      expect(dockAfterDock.dockedShips).to.equal(countAfterUndock + 1);

      // Restore
      await resetSeedData();
    });

    it('sets crew busy after docking', async function () {
      // Undock and then dock
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Station crew on ship
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      const nowBefore = Math.floor(Date.now() / 1000);

      // Dock
      const res = await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
      expect(res.status).to.equal(200);

      // Verify crew readyAt > now
      const crew = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      expect(crew.readyAt).to.be.greaterThan(nowBefore);

      // Restore
      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  StationCrew on Ship
  // ═══════════════════════════════════════════════════════════════

  describe('StationCrew on Ship', function () {
    it('allows a second crew from the same wallet to board the ship', async function () {
      // Crew 2 is owned by the same wallet as crew 1 (the ship controller)
      const res = await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_2,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      expect(res.status).to.equal(200);

      // Verify crew 2 is now on the ship
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': CREW_2.id, 'entity.label': 1
      }).lean();
      expect(loc.location.id).to.equal(SHIP_1.id);
      expect(loc.location.label).to.equal(6);

      // Restore
      await resetSeedData();
    });

    it('rejects crew from a different wallet without permission', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CommandeerShip
  // ═══════════════════════════════════════════════════════════════

  describe('CommandeerShip', function () {
    it('transfers ship control to caller crew', async function () {
      // Crew 2 commandeers ship (same wallet owns both crew and ship NFT)
      const res = await postAction(server, TOKEN, 'CommandeerShip', {
        caller_crew: CREW_2,
        ship: SHIP_1
      });

      expect(res.status).to.equal(200);

      // Verify DB: ship controller is now crew 2
      const control = await mongoose.model('ControlComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(control.controller.id).to.equal(CREW_2.id);

      // Restore
      await resetSeedData();
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CommandeerShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when caller does not own ship', async function () {
      // WRONG_TOKEN wallet does not own SHIP_1 (or CREW_1), so this fails
      const res = await postAction(server, WRONG_TOKEN, 'CommandeerShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  TransitBetweenStart
  // ═══════════════════════════════════════════════════════════════

  describe('TransitBetweenStart', function () {
    it('starts transit to another asteroid', async function () {
      // First undock the ship
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Move crew to ship first
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      const now = Math.floor(Date.now() / 1000);
      const res = await postAction(server, TOKEN, 'TransitBetweenStart', {
        caller_crew: CREW_1,
        destination: { id: ASTEROID_2.id, label: ASTEROID_2.label },
        departure_time: now,
        arrival_time: now + 3600
      });

      expect(res.status).to.equal(200);

      // Verify DB: ship has transit data
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(ship.transitArrival).to.be.greaterThan(0);

      // Cleanup: reset seed data to avoid complex state restoration
      await resetSeedData();
    });

    it('rejects when destination is missing', async function () {
      const res = await postAction(server, TOKEN, 'TransitBetweenStart', {
        caller_crew: CREW_1,
        departure_time: Math.floor(Date.now() / 1000),
        arrival_time: Math.floor(Date.now() / 1000) + 3600
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('destination');
    });

    it('rejects when caller does not control crew', async function () {
      const now = Math.floor(Date.now() / 1000);
      const res = await postAction(server, WRONG_TOKEN, 'TransitBetweenStart', {
        caller_crew: CREW_1,
        destination: { id: ASTEROID_2.id, label: ASTEROID_2.label },
        departure_time: now,
        arrival_time: now + 3600
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('sets ship readyAt to finish time', async function () {
      // Undock the ship
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
      await setCrewBusy(CREW_1.id, 0);

      // Move crew to ship
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });

      const now = Math.floor(Date.now() / 1000);
      const res = await postAction(server, TOKEN, 'TransitBetweenStart', {
        caller_crew: CREW_1,
        destination: { id: ASTEROID_2.id, label: ASTEROID_2.label },
        departure_time: now,
        arrival_time: now + 3600
      });

      expect(res.status).to.equal(200);

      // Verify ship readyAt equals the arrival time
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(ship.readyAt).to.equal(ship.transitArrival);
      expect(ship.readyAt).to.be.greaterThan(0);

      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  AssembleShipStart
  // ═══════════════════════════════════════════════════════════════

  describe('AssembleShipStart', function () {
    it('starts ship assembly at shipyard', async function () {
      const res = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2, // Light Transport
        dry_dock_slot: 1,
        origin: { id: 11, label: 5 },
        origin_slot: 2
      });

      expect(res.status).to.equal(200);
      const rv = res.body.event.returnValues;
      expect(rv.ship).to.have.property('id');
      expect(rv.ship.id).to.be.greaterThan(100000000);

      // Verify DB: Ship entity created with UNDER_CONSTRUCTION status
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': rv.ship.id, 'entity.label': 6
      }).lean();
      expect(ship).to.exist;
      expect(ship.status).to.equal(Ship.STATUSES.UNDER_CONSTRUCTION);

      // Cleanup
      await mongoose.model('ShipComponent').deleteOne({ 'entity.id': rv.ship.id });
      await mongoose.model('Entity').deleteOne({ id: rv.ship.id, label: 6 });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': rv.ship.id, 'entity.label': 6 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': rv.ship.id, 'entity.label': 6 });
      await resetSeedData();
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects invalid ship type', async function () {
      const res = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 99999,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.be.a('string');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('consumes materials from origin inventory', async function () {
      // Check origin inventory before
      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': 11, 'entity.label': 5, slot: 2
      }).lean();
      const cargoModuleBefore = invBefore.contents.find((c) => c.product === 148);
      expect(cargoModuleBefore).to.exist;
      expect(cargoModuleBefore.amount).to.equal(6);

      const res = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2, // Light Transport
        dry_dock_slot: 1,
        origin: { id: 11, label: 5 },
        origin_slot: 2
      });

      expect(res.status).to.equal(200);

      // After assembly, origin inventory should have materials deducted
      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': 11, 'entity.label': 5, slot: 2
      }).lean();
      // Light Transport requires exactly 6 cargo modules, so they should all be consumed
      const cargoModuleAfter = invAfter.contents.find((c) => c.product === 148);
      expect(cargoModuleAfter).to.not.exist; // All consumed (6-6=0, filtered out)

      // All materials should be consumed since seed has exact amounts for 1 ship
      expect(invAfter.contents.length).to.equal(0);
      expect(invAfter.mass).to.equal(0);

      // Cleanup
      const rv = res.body.event.returnValues;
      await mongoose.model('ShipComponent').deleteOne({ 'entity.id': rv.ship.id });
      await mongoose.model('Entity').deleteOne({ id: rv.ship.id, label: 6 });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': rv.ship.id, 'entity.label': 6 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': rv.ship.id, 'entity.label': 6 });
      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  AssembleShipFinish
  // ═══════════════════════════════════════════════════════════════

  describe('AssembleShipFinish', function () {
    it('finishes ship assembly and sets status to AVAILABLE', async function () {
      // First start assembly to create an UNDER_CONSTRUCTION ship
      const startRes = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2, // Light Transport
        dry_dock_slot: 1,
        origin: { id: 11, label: 5 },
        origin_slot: 2
      });

      expect(startRes.status).to.equal(200);
      const newShipId = startRes.body.event.returnValues.ship.id;

      // Clear crew busy so finish can proceed
      await setCrewBusy(CREW_1.id, 0);

      // Finish assembly
      const res = await postAction(server, TOKEN, 'AssembleShipFinish', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(200);

      // Verify DB: ship status is now AVAILABLE
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': newShipId, 'entity.label': 6
      }).lean();
      expect(ship).to.exist;
      expect(ship.status).to.equal(Ship.STATUSES.AVAILABLE);

      // Cleanup: delete created ship entities
      await mongoose.model('ShipComponent').deleteOne({ 'entity.id': newShipId });
      await mongoose.model('Entity').deleteOne({ id: newShipId, label: 6 });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('InventoryComponent').deleteMany({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('StationComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await resetSeedData();
    });

    it('rejects when no ship at dry dock', async function () {
      const res = await postAction(server, TOKEN, 'AssembleShipFinish', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(400);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'AssembleShipFinish', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('creates ship inventories and station', async function () {
      // Start assembly
      const startRes = await postAction(server, TOKEN, 'AssembleShipStart', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        ship_type: 2, // Light Transport
        dry_dock_slot: 1,
        origin: { id: 11, label: 5 },
        origin_slot: 2
      });

      expect(startRes.status).to.equal(200);
      const newShipId = startRes.body.event.returnValues.ship.id;

      // Clear crew busy
      await setCrewBusy(CREW_1.id, 0);

      // Finish assembly
      const res = await postAction(server, TOKEN, 'AssembleShipFinish', {
        caller_crew: CREW_1,
        dry_dock: SHIPYARD,
        dry_dock_slot: 1
      });

      expect(res.status).to.equal(200);

      // Verify propellant inventory was created (slot 1 for Light Transport)
      const propellantInv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': newShipId, 'entity.label': 6, slot: 1
      }).lean();
      expect(propellantInv).to.exist;
      expect(propellantInv.inventoryType).to.equal(13); // PROPELLANT_MEDIUM for Light Transport
      expect(propellantInv.status).to.equal(1);
      expect(propellantInv.mass).to.equal(0);
      expect(propellantInv.contents).to.be.an('array').that.is.empty;

      // Verify cargo inventory was created (slot 2 for Light Transport)
      const cargoInv = await mongoose.model('InventoryComponent').findOne({
        'entity.id': newShipId, 'entity.label': 6, slot: 2
      }).lean();
      expect(cargoInv).to.exist;
      expect(cargoInv.inventoryType).to.equal(16); // CARGO_MEDIUM for Light Transport
      expect(cargoInv.status).to.equal(1);
      expect(cargoInv.mass).to.equal(0);
      expect(cargoInv.contents).to.be.an('array').that.is.empty;

      // Verify station component was created
      const station = await mongoose.model('StationComponent').findOne({
        'entity.id': newShipId, 'entity.label': 6
      }).lean();
      expect(station).to.exist;
      expect(station.stationType).to.equal(1); // Standard Quarters for Light Transport
      expect(station.population).to.equal(0);

      // Cleanup
      await mongoose.model('ShipComponent').deleteOne({ 'entity.id': newShipId });
      await mongoose.model('Entity').deleteOne({ id: newShipId, label: 6 });
      await mongoose.model('LocationComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('InventoryComponent').deleteMany({ 'entity.id': newShipId, 'entity.label': 6 });
      await mongoose.model('StationComponent').deleteOne({ 'entity.id': newShipId, 'entity.label': 6 });
      await resetSeedData();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  TransitBetweenFinish
  // ═══════════════════════════════════════════════════════════════

  describe('TransitBetweenFinish', function () {
    it('finishes transit and clears transit fields', async function () {
      // Set up state: put crew on ship and set ship in transit with past arrival
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { 'location.id': SHIP_1.id, 'location.label': 6 } }
      );

      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ShipComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6 },
        { $set: {
          transitArrival: pastTime,
          transitDeparture: pastTime - 3600,
          transitOrigin: { id: 1, label: 3 },
          transitDestination: { id: 2, label: 3 }
        } }
      );

      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(200);

      // Verify DB: transit fields cleared
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(ship.transitArrival).to.equal(0);

      // Cleanup
      await resetSeedData();
    });

    it('rejects when crew is not on a ship', async function () {
      // Crew is at habitat (default seed state), not on a ship
      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('clears transit origin', async function () {
      // Set up state: crew on ship, ship in transit with past arrival
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { 'location.id': SHIP_1.id, 'location.label': 6 } }
      );

      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await mongoose.model('ShipComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6 },
        { $set: {
          transitArrival: pastTime,
          transitDeparture: pastTime - 3600,
          transitOrigin: { id: 1, label: 3 },
          transitDestination: { id: 2, label: 3 }
        } }
      );

      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(200);

      // Verify transit origin is cleared (may be null, undefined, or {id:0/null})
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      const originId = ship.transitOrigin?.id || 0;
      const destId = ship.transitDestination?.id || 0;
      expect(originId).to.equal(0);
      expect(destId).to.equal(0);

      await resetSeedData();
    });
  });
});
