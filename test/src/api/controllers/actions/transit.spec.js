const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Asteroid, Entity, GM_ADALIA, Product, Ship, Time } = require('@influenceth/sdk');
const { angles: astroAngles, elements: astroElements, lambert } = require('@influenceth/astro');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, ASTEROID_2,
  SPACEPORT, SHIP_1,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy
} = require('@test/helpers/actionTestHelper');

// ── Orbital helpers (mirroring the handler) ──────────────────────────────────

const MU_KM = GM_ADALIA / 1e9;

function getPV(orbit, t) {
  const period = 2 * Math.PI * Math.sqrt(orbit.a ** 3 / MU_KM);
  const M = orbit.m + 2 * Math.PI * t / period;
  const E = astroAngles.M_to_E(M, orbit.ecc);
  const nu = astroAngles.E_to_nu(E, orbit.ecc);
  const p = orbit.a * (1 - orbit.ecc ** 2);
  return astroElements.coe2rv(MU_KM, p, orbit.ecc, orbit.inc, orbit.raan, orbit.argp, nu);
}

// Seed orbit data (from data.json)
const AST1_ORBIT = { a: 409150176.4, argp: 4.8518, ecc: 0.0791, inc: 0.1803, m: 3.8671, raan: 1.2915 };
const AST2_ORBIT = { a: 446100850.4, argp: 3.5, ecc: 0.12, inc: 0.21, m: 1.2, raan: 2.1 };

// Pre-computed valid Lambert transit (dep=50M, arr=90M game seconds, ~30.8 km/s dv, ~19 real days)
const TRANSIT = {
  departureTime: 50000000,
  arrivalTime: 90000000,
  transit_p: 268928190.6980401,
  transit_ecc: 0.7904679447360337,
  transit_inc: 0.21688480734922447,
  transit_raan: 1.645846368176655,
  transit_argp: 6.0090415681971905,
  transit_nu_start: -1.9482325811422543,
  transit_nu_end: 2.1372514312496786,
  propNeededUnits: 468624
};

/** Build the full vars object for a valid TransitBetweenStart call. */
function transitVars(overrides = {}) {
  return {
    caller_crew: CREW_1,
    ship: SHIP_1,
    origin: ASTEROID_1,
    destination: ASTEROID_2,
    departure_time: TRANSIT.departureTime,
    arrival_time: TRANSIT.arrivalTime,
    transit_p: TRANSIT.transit_p,
    transit_ecc: TRANSIT.transit_ecc,
    transit_inc: TRANSIT.transit_inc,
    transit_raan: TRANSIT.transit_raan,
    transit_argp: TRANSIT.transit_argp,
    transit_nu_start: TRANSIT.transit_nu_start,
    transit_nu_end: TRANSIT.transit_nu_end,
    ...overrides
  };
}

/** Undock ship and clear crew busy, putting ship in orbit for transit tests. */
async function undockShip(server) {
  await postAction(server, TOKEN, 'UndockShip', {
    caller_crew: CREW_1,
    ship: SHIP_1
  });
  await setCrewBusy(CREW_1.id, 0);

  // Clear ship readyAt so it's immediately ready
  await mongoose.model('ShipComponent').updateOne(
    { 'entity.id': SHIP_1.id, 'entity.label': 6 },
    { $set: { readyAt: 0 } }
  );

  // Move crew onto the ship (seed data has crew at Habitat)
  await mongoose.model('LocationComponent').updateOne(
    { 'entity.id': CREW_1.id, 'entity.label': 1 },
    { $set: {
      location: { id: SHIP_1.id, label: 6 },
      locations: [
        { id: SHIP_1.id, label: 6 },
        { id: ASTEROID_1.id, label: 3 }
      ]
    } }
  );
}

describe('Actions – Transit', function () {
  let server;
  let sandbox;

  before(async function () {
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
    server = buildActionServer();
  });

  beforeEach(async function () {
    await resetSeedData();
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
  //  TransitBetweenStart
  // ═══════════════════════════════════════════════════════════════

  describe('TransitBetweenStart', function () {

    it('starts transit with valid parameters', async function () {
      await undockShip(server);

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify ship component has transit data
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(ship.transitDeparture).to.equal(TRANSIT.departureTime);
      expect(ship.transitArrival).to.equal(TRANSIT.arrivalTime);

      // During transit, ship is "in space" — no asteroid in location chain
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(loc.locations).to.have.length(0);
    });

    it('consumes propellant from inventory', async function () {
      await undockShip(server);

      const invBefore = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propBefore = invBefore.contents.find((c) => c.product === 170).amount;

      await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      const invAfter = await mongoose.model('InventoryComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1
      }).lean();
      const propAfter = invAfter.contents.find((c) => c.product === 170).amount;

      expect(propAfter).to.equal(propBefore - TRANSIT.propNeededUnits);
      expect(propAfter).to.be.greaterThan(0);

      // Mass/volume should be recalculated
      const pt = Product.TYPES[170];
      expect(invAfter.mass).to.equal(propAfter * pt.massPerUnit);
      expect(invAfter.volume).to.equal(propAfter * pt.volumePerUnit);
    });

    it('marks crew as busy until arrival', async function () {
      await undockShip(server);

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );
      expect(res.status).to.equal(200);

      const crew = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();

      // readyAt = EPOCH + ceil(arrivalTime / timeAccel), which is a 2021 IRL timestamp
      const EPOCH = 1609459200; // Time.ORBIT_ZERO_TIMESTAMP
      const expectedReadyAt = EPOCH + Math.ceil(TRANSIT.arrivalTime / 24);
      expect(crew.readyAt).to.equal(expectedReadyAt);
    });

    // ── Validation rejection tests ─────────────────────────────

    it('rejects when ship is docked (not in orbit)', async function () {
      // Ship starts docked at spaceport in seed data
      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('docked');
    });

    it('rejects when caller does not control crew', async function () {
      await undockShip(server);

      const res = await postAction(
        server, WRONG_TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
    });

    it('rejects when crew does not control ship', async function () {
      await undockShip(server);

      // Use CREW_2 which doesn't control SHIP_1
      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars({ caller_crew: CREW_2 }),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('control');
    });

    it('rejects when crew is busy', async function () {
      await undockShip(server);
      await setCrewBusy(CREW_1.id, Math.floor(Date.now() / 1000) + 99999);

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
    });

    it('rejects when ship is not AVAILABLE', async function () {
      await undockShip(server);

      // Set ship to UNDER_CONSTRUCTION
      await mongoose.model('ShipComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6 },
        { $set: { status: Ship.STATUSES.UNDER_CONSTRUCTION } }
      );

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not available');
    });

    it('rejects when destination is not surface-scanned', async function () {
      await undockShip(server);

      // Set destination asteroid to UNSCANNED
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': ASTEROID_2.id, 'entity.label': 3 },
        { $set: { scanStatus: Asteroid.SCAN_STATUSES.UNSCANNED } }
      );

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('scanned');
    });

    it('rejects when ship has delivery reservations', async function () {
      await undockShip(server);

      // Add reservations to propellant inventory
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1 },
        { $set: { reservedMass: 1000, reservedVolume: 1000 } }
      );

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('reservation');
    });

    it('rejects when arrival time is before departure', async function () {
      await undockShip(server);

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars({
          arrival_time: TRANSIT.departureTime - 1000
        }),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('after departure');
    });

    it('rejects when propellant is insufficient', async function () {
      await undockShip(server);

      // Drain the propellant tank
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6, slot: 1 },
        { $set: { mass: 0, volume: 0, contents: [] } }
      );

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('propellant');
    });

    it('rejects when no propellant usage is provided', async function () {
      await undockShip(server);

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        {} // no usedPropellantMass
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not specified');
    });

    it('rejects when transit orbital elements are invalid (position mismatch)', async function () {
      await undockShip(server);

      // Provide garbage orbital elements
      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars({
          transit_p: 100000000,
          transit_ecc: 0.01,
          transit_inc: 0.01,
          transit_raan: 0.01,
          transit_argp: 0.01,
          transit_nu_start: 0.5,
          transit_nu_end: 1.5
        }),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('position');
    });

    it('rejects when transit orbital elements are missing', async function () {
      await undockShip(server);

      const vars = transitVars();
      delete vars.transit_p;

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        vars,
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('orbital elements');
    });

    it('rejects when crew has no crewmates', async function () {
      await undockShip(server);

      // Empty the crew roster
      await mongoose.model('CrewComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { roster: [] } }
      );

      const res = await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('crewmates');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  TransitBetweenFinish
  // ═══════════════════════════════════════════════════════════════

  describe('TransitBetweenFinish', function () {

    it('finishes transit when arrival time has passed', async function () {
      await undockShip(server);

      // Start transit
      await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      // Fast-forward: set ship transitArrival to past and clear crew busy
      const now = Math.floor(Date.now() / 1000);
      await mongoose.model('ShipComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6 },
        { $set: { transitArrival: now - 10, readyAt: now - 10 } }
      );
      await setCrewBusy(CREW_1.id, 0);

      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify transit data cleared
      const ship = await mongoose.model('ShipComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(ship.transitDeparture).to.equal(0);
      expect(ship.transitArrival).to.equal(0);

      // Verify ship is now in orbit at destination asteroid
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': SHIP_1.id, 'entity.label': 6
      }).lean();
      expect(loc.location.id).to.equal(ASTEROID_2.id);
      expect(loc.location.label).to.equal(ASTEROID_2.label);
    });

    it('rejects when transit has not finished yet', async function () {
      await undockShip(server);

      // Start transit
      await postAction(
        server, TOKEN, 'TransitBetweenStart',
        transitVars(),
        { usedPropellantMass: TRANSIT.propNeededUnits }
      );

      // Set readyAt to the future so transit is still "in progress"
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await mongoose.model('ShipComponent').updateOne(
        { 'entity.id': SHIP_1.id, 'entity.label': 6 },
        { $set: { readyAt: futureTime } }
      );
      // But crew must be ready to call the action
      await setCrewBusy(CREW_1.id, 0);

      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished');
    });

    it('rejects when ship is not in transit', async function () {
      // Ship is docked, not in transit
      const res = await postAction(server, TOKEN, 'TransitBetweenFinish', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
    });
  });
});
