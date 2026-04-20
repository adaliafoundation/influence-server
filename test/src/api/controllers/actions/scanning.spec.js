const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Asteroid } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, ASTEROID_1,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy, createUnscannedAsteroid
} = require('@test/helpers/actionTestHelper');

describe('Actions – Scanning', function () {
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
  //  ScanSurfaceStart
  // ═══════════════════════════════════════════════════════════════

  describe('ScanSurfaceStart', function () {
    it('starts surface scan on an UNSCANNED asteroid', async function () {
      const asteroid = await createUnscannedAsteroid(100);

      const res = await postAction(server, TOKEN, 'ScanSurfaceStart', {
        caller_crew: CREW_1,
        asteroid: { id: 100 }
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.a('number');
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );

      // Verify DB
      const celestial = await mongoose.model('CelestialComponent').findOne({
        'entity.id': 100, 'entity.label': 3
      }).lean();
      expect(celestial.scanStatus).to.equal(Asteroid.SCAN_STATUSES.SURFACE_SCANNING);
      expect(celestial.scanFinishTime).to.be.greaterThan(0);

      // Cleanup: reset crew readyAt
      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when asteroid is already scanned', async function () {
      // ASTEROID_1 has scanStatus=4 (RESOURCE_SCANNED)
      const res = await postAction(server, TOKEN, 'ScanSurfaceStart', {
        caller_crew: CREW_1,
        asteroid: ASTEROID_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('UNSCANNED');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      await createUnscannedAsteroid(101);
      const res = await postAction(server, TOKEN, 'ScanSurfaceStart', {
        caller_crew: CREW_1,
        asteroid: { id: 101 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when caller does not control crew', async function () {
      await createUnscannedAsteroid(102);
      const res = await postAction(server, WRONG_TOKEN, 'ScanSurfaceStart', {
        caller_crew: CREW_1,
        asteroid: { id: 102 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew does not control asteroid', async function () {
      await createUnscannedAsteroid(103);
      // Set asteroid controller to a different crew (id=99)
      await mongoose.model('ControlComponent').updateOne(
        { 'entity.id': 103, 'entity.label': 3 },
        { $set: { controller: { id: 99, label: 1 } } }
      );

      const res = await postAction(server, TOKEN, 'ScanSurfaceStart', {
        caller_crew: CREW_1,
        asteroid: { id: 103 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('control');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ScanSurfaceFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ScanSurfaceFinish', function () {
    it('finishes surface scan when time has passed', async function () {
      // Set up asteroid in SURFACE_SCANNING state with past finishTime
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createUnscannedAsteroid(200);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 200, 'entity.label': 3 },
        { $set: {
          scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNING,
          scanFinishTime: pastTime
        }}
      );

      const res = await postAction(server, TOKEN, 'ScanSurfaceFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 200 }
      });

      expect(res.status).to.equal(200);

      // Verify DB: asteroid is now SURFACE_SCANNED
      const celestial = await mongoose.model('CelestialComponent').findOne({
        'entity.id': 200, 'entity.label': 3
      }).lean();
      expect(celestial.scanStatus).to.equal(Asteroid.SCAN_STATUSES.SURFACE_SCANNED);
      expect(celestial.bonuses).to.be.a('number');
    });

    it('rejects when asteroid is not SURFACE_SCANNING', async function () {
      // ASTEROID_1 is RESOURCE_SCANNED
      const res = await postAction(server, TOKEN, 'ScanSurfaceFinish', {
        caller_crew: CREW_1,
        asteroid: ASTEROID_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not currently surface scanning');
    });

    it('rejects when scan has not finished yet', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await createUnscannedAsteroid(201);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 201, 'entity.label': 3 },
        { $set: {
          scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNING,
          scanFinishTime: futureTime
        }}
      );

      const res = await postAction(server, TOKEN, 'ScanSurfaceFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 201 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished yet');
    });

    it('rejects when caller does not own crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ScanSurfaceFinish', {
        caller_crew: CREW_1,
        asteroid: ASTEROID_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when crew does not control asteroid', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createUnscannedAsteroid(202);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 202, 'entity.label': 3 },
        { $set: { scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNING, scanFinishTime: pastTime } }
      );
      // Set asteroid controller to a different crew
      await mongoose.model('ControlComponent').updateOne(
        { 'entity.id': 202, 'entity.label': 3 },
        { $set: { controller: { id: 99, label: 1 } } }
      );

      const res = await postAction(server, TOKEN, 'ScanSurfaceFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 202 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('control');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ScanResourcesStart
  // ═══════════════════════════════════════════════════════════════

  describe('ScanResourcesStart', function () {
    it('starts resource scan on a SURFACE_SCANNED asteroid', async function () {
      // Set up asteroid in SURFACE_SCANNED state
      await createUnscannedAsteroid(300);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 300, 'entity.label': 3 },
        { $set: { scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNED, bonuses: 42 } }
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesStart', {
        caller_crew: CREW_1,
        asteroid: { id: 300 }
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.finishTime).to.be.greaterThan(
        Math.floor(Date.now() / 1000)
      );

      // Verify DB
      const celestial = await mongoose.model('CelestialComponent').findOne({
        'entity.id': 300, 'entity.label': 3
      }).lean();
      expect(celestial.scanStatus).to.equal(Asteroid.SCAN_STATUSES.RESOURCE_SCANNING);

      // Cleanup: reset crew readyAt
      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when asteroid is not SURFACE_SCANNED', async function () {
      // ASTEROID_1 is RESOURCE_SCANNED (status 4), not SURFACE_SCANNED (status 2)
      const res = await postAction(server, TOKEN, 'ScanResourcesStart', {
        caller_crew: CREW_1,
        asteroid: ASTEROID_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('surface-scanned');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      await createUnscannedAsteroid(301);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 301, 'entity.label': 3 },
        { $set: { scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNED } }
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesStart', {
        caller_crew: CREW_1,
        asteroid: { id: 301 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when crew does not control asteroid', async function () {
      await createUnscannedAsteroid(302);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 302, 'entity.label': 3 },
        { $set: { scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNED } }
      );
      // Set asteroid controller to a different crew
      await mongoose.model('ControlComponent').updateOne(
        { 'entity.id': 302, 'entity.label': 3 },
        { $set: { controller: { id: 99, label: 1 } } }
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesStart', {
        caller_crew: CREW_1,
        asteroid: { id: 302 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('control');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ScanResourcesFinish
  // ═══════════════════════════════════════════════════════════════

  describe('ScanResourcesFinish', function () {
    it('finishes resource scan and generates abundances', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createUnscannedAsteroid(400);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 400, 'entity.label': 3 },
        { $set: {
          scanStatus: Asteroid.SCAN_STATUSES.RESOURCE_SCANNING,
          scanFinishTime: pastTime,
          bonuses: 42
        }}
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 400 }
      });

      expect(res.status).to.equal(200);

      // Verify DB: RESOURCE_SCANNED with abundances
      const celestial = await mongoose.model('CelestialComponent').findOne({
        'entity.id': 400, 'entity.label': 3
      }).lean();
      expect(celestial.scanStatus).to.equal(Asteroid.SCAN_STATUSES.RESOURCE_SCANNED);
      expect(celestial.abundances).to.not.be.empty;
    });

    it('rejects when asteroid is not RESOURCE_SCANNING', async function () {
      const res = await postAction(server, TOKEN, 'ScanResourcesFinish', {
        caller_crew: CREW_1,
        asteroid: ASTEROID_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not currently resource scanning');
    });

    it('rejects when scan has not finished yet', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await createUnscannedAsteroid(401);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 401, 'entity.label': 3 },
        { $set: {
          scanStatus: Asteroid.SCAN_STATUSES.RESOURCE_SCANNING,
          scanFinishTime: futureTime,
          bonuses: 42
        }}
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 401 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not finished yet');
    });

    it('rejects when crew does not control asteroid', async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await createUnscannedAsteroid(402);
      await mongoose.model('CelestialComponent').updateOne(
        { 'entity.id': 402, 'entity.label': 3 },
        { $set: {
          scanStatus: Asteroid.SCAN_STATUSES.RESOURCE_SCANNING,
          scanFinishTime: pastTime,
          bonuses: 42
        }}
      );
      // Set asteroid controller to a different crew
      await mongoose.model('ControlComponent').updateOne(
        { 'entity.id': 402, 'entity.label': 3 },
        { $set: { controller: { id: 99, label: 1 } } }
      );

      const res = await postAction(server, TOKEN, 'ScanResourcesFinish', {
        caller_crew: CREW_1,
        asteroid: { id: 402 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('control');
    });
  });
});
