const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, WAREHOUSE, HABITAT,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setCrewBusy
} = require('@test/helpers/actionTestHelper');

describe('Actions – Crew operations', function () {
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
  //  StationCrew
  // ═══════════════════════════════════════════════════════════════

  describe('StationCrew', function () {
    it('moves crew to a new destination', async function () {
      // Move crew 1 from habitat (building 8) to warehouse (building 1)
      const res = await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label }
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');
      expect(res.body.event.returnValues.destinationStation.id).to.equal(WAREHOUSE.id);

      // Verify DB: crew location updated
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      expect(loc.location.id).to.equal(WAREHOUSE.id);

      // Restore: move back to habitat
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: HABITAT.id, label: HABITAT.label }
      });
    });

    it('rejects when destination does not exist', async function () {
      const res = await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: 999999, label: 5 }
      });

      expect(res.status).to.equal(400);
      // May fail with "Destination not found" or "Permission denied" depending on lookup order
      expect(res.body.error).to.be.a('string');
    });

    it('rejects when crew is busy', async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 99999;
      await setCrewBusy(CREW_1.id, futureTime);

      const res = await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('busy');

      await setCrewBusy(CREW_1.id, 0);
    });

    it('rejects when caller does not own the crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when destination is missing id or label', async function () {
      const res = await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_1,
        destination: { id: 1 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('destination');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  EjectCrew
  // ═══════════════════════════════════════════════════════════════

  describe('EjectCrew', function () {
    it('ejects crew 2 to the asteroid', async function () {
      // Both crews are at habitat (building 8). Crew 1 controls the habitat.
      const res = await postAction(server, TOKEN, 'EjectCrew', {
        caller_crew: CREW_1,
        ejected_crew: CREW_2
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('event');

      // Verify DB: ejected crew is now at the asteroid level
      const loc = await mongoose.model('LocationComponent').findOne({
        'entity.id': CREW_2.id, 'entity.label': 1
      }).lean();
      expect(loc.location.label).to.equal(3); // Asteroid

      // Restore: station crew 2 back at habitat
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_2,
        destination: { id: HABITAT.id, label: HABITAT.label }
      });
    });

    it('rejects when ejected crew does not exist', async function () {
      const res = await postAction(server, TOKEN, 'EjectCrew', {
        caller_crew: CREW_1,
        ejected_crew: { id: 999999, label: 1 }
      });

      expect(res.status).to.equal(400);
      // Fails with either "Ejected crew not found" or "Crews must be stationed"
      expect(res.body.error).to.be.a('string');
    });

    it('rejects when crews are not at the same station', async function () {
      // Move crew 2 to warehouse first so they're at different stations
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_2,
        destination: { id: WAREHOUSE.id, label: WAREHOUSE.label }
      });

      const res = await postAction(server, TOKEN, 'EjectCrew', {
        caller_crew: CREW_1,
        ejected_crew: CREW_2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not at the same station');

      // Restore
      await postAction(server, TOKEN, 'StationCrew', {
        caller_crew: CREW_2,
        destination: { id: HABITAT.id, label: HABITAT.label }
      });
    });

    it('rejects when caller does not control the station', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'EjectCrew', {
        caller_crew: CREW_1,
        ejected_crew: CREW_2
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ArrangeCrew
  // ═══════════════════════════════════════════════════════════════

  describe('ArrangeCrew', function () {
    it('reorders the crew roster', async function () {
      // Crew 1 has roster [1,2,3] — rearrange to [3,1,2]
      const res = await postAction(server, TOKEN, 'ArrangeCrew', {
        caller_crew: CREW_1,
        composition: [3, 1, 2]
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.compositionNew).to.deep.equal([3, 1, 2]);

      // Verify DB
      const crew = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      expect(crew.roster).to.deep.equal([3, 1, 2]);

      // Restore
      await postAction(server, TOKEN, 'ArrangeCrew', {
        caller_crew: CREW_1,
        composition: [1, 2, 3]
      });
    });

    it('rejects when composition contains different crewmates', async function () {
      const res = await postAction(server, TOKEN, 'ArrangeCrew', {
        caller_crew: CREW_1,
        composition: [1, 2, 99]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('same crewmates');
    });

    it('rejects when composition is empty', async function () {
      const res = await postAction(server, TOKEN, 'ArrangeCrew', {
        caller_crew: CREW_1,
        composition: []
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('non-empty');
    });

    it('rejects when caller does not own crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ArrangeCrew', {
        caller_crew: CREW_1,
        composition: [3, 1, 2]
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ExchangeCrew
  // ═══════════════════════════════════════════════════════════════

  describe('ExchangeCrew', function () {
    it('swaps crewmates between two crews at the same location', async function () {
      // Ensure both crews are at the same location (habitat)
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_2.id, 'entity.label': 1 },
        { $set: { 'location.id': HABITAT.id, 'location.label': HABITAT.label } }
      );

      // Crew 1 roster: [1,2,3], Crew 2 roster: [4,5]
      // Swap: crew1 gets [1,4], crew2 gets [2,3,5]
      const res = await postAction(server, TOKEN, 'ExchangeCrew', {
        crew1: CREW_1,
        comp1: [1, 4],
        _crew2: CREW_2,
        comp2: [2, 3, 5],
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(200);

      // Verify DB
      const c1 = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      const c2 = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_2.id, 'entity.label': 1
      }).lean();
      expect(c1.roster.map(Number).sort()).to.deep.equal([1, 4]);
      expect(c2.roster.map(Number).sort()).to.deep.equal([2, 3, 5]);

      // Restore
      await postAction(server, TOKEN, 'ExchangeCrew', {
        crew1: CREW_1,
        comp1: [1, 2, 3],
        _crew2: CREW_2,
        comp2: [4, 5],
        caller_crew: CREW_1
      });
    });

    it('rejects when crewmates are not redistributed correctly', async function () {
      // Ensure both crews are at the same location first
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_2.id, 'entity.label': 1 },
        { $set: { 'location.id': HABITAT.id, 'location.label': HABITAT.label } }
      );

      const res = await postAction(server, TOKEN, 'ExchangeCrew', {
        crew1: CREW_1,
        comp1: [1, 2],
        _crew2: CREW_2,
        comp2: [4, 5, 99],
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('same crewmates');
    });

    it('rejects when crews are at different locations', async function () {
      // Directly set crew 2 to warehouse via DB to avoid side effect entanglement
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_2.id, 'entity.label': 1 },
        { $set: { 'location.id': WAREHOUSE.id, 'location.label': WAREHOUSE.label } }
      );

      const res = await postAction(server, TOKEN, 'ExchangeCrew', {
        crew1: CREW_1,
        comp1: [1, 4],
        _crew2: CREW_2,
        comp2: [2, 3, 5],
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('same location');

      // Restore
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_2.id, 'entity.label': 1 },
        { $set: { 'location.id': HABITAT.id, 'location.label': HABITAT.label } }
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ResupplyFood
  // ═══════════════════════════════════════════════════════════════

  describe('ResupplyFood', function () {
    it('updates crew lastFed timestamp', async function () {
      const res = await postAction(server, TOKEN, 'ResupplyFood', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        food: 100
      });

      expect(res.status).to.equal(200);
      expect(res.body.event.returnValues.lastFed).to.be.a('number');
      expect(res.body.event.returnValues.food).to.equal(100);

      // Verify DB
      const crew = await mongoose.model('CrewComponent').findOne({
        'entity.id': CREW_1.id, 'entity.label': 1
      }).lean();
      expect(crew.lastFed).to.be.greaterThan(0);
    });

    it('rejects when food is zero or negative', async function () {
      const res = await postAction(server, TOKEN, 'ResupplyFood', {
        caller_crew: CREW_1,
        origin: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        origin_slot: 1,
        food: 0
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('positive');
    });

    it('rejects when origin is missing', async function () {
      const res = await postAction(server, TOKEN, 'ResupplyFood', {
        caller_crew: CREW_1,
        origin_slot: 1,
        food: 100
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('origin');
    });
  });
});
