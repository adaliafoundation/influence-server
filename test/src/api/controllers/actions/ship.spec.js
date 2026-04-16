const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Ship } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, ASTEROID_2,
  WAREHOUSE, SPACEPORT, SHIPYARD, SHIP_1,
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

      // Restore: station crew on ship, then dock
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });
      await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
    });

    it('rejects when ship is not docked at a building', async function () {
      // First undock
      await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      // Try undocking again — ship is at asteroid, not a building
      const res = await postAction(server, TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not docked');

      // Restore: station crew on ship, dock, then station crew at habitat
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SHIP_1.id, label: SHIP_1.label }
      });
      await postAction(server, TOKEN, 'DockShip', {
        caller_crew: CREW_1,
        target: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'UndockShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
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

      // Restore: crew back to habitat
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: SPACEPORT.id, label: SPACEPORT.label }
      });
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
  });

  // ═══════════════════════════════════════════════════════════════
  //  CommandeerShip
  // ═══════════════════════════════════════════════════════════════

  describe('CommandeerShip', function () {
    it('transfers ship control to caller crew', async function () {
      // Crew 1 controls ship. Transfer to crew 2 (both controlled by same wallet)
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

      // Restore: transfer back to crew 1
      await postAction(server, TOKEN, 'CommandeerShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'CommandeerShip', {
        caller_crew: CREW_1,
        ship: SHIP_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
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
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1
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
  });
});
