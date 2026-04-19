const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, WAREHOUSE,
  buildActionServer, postAction, applyStubs,
  resetSeedData
} = require('@test/helpers/actionTestHelper');

describe('Actions endpoint – auth & validation', function () {
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

  // ── Authentication ─────────────────────────────────────────────

  it('returns 401 without a token', async function () {
    const res = await server
      .post('/v2/actions/ConstructionPlan')
      .send({ callerCrew: CREW_1, vars: {} });

    expect(res.status).to.equal(401);
  });

  it('returns 401 with an invalid token', async function () {
    const res = await server
      .post('/v2/actions/ConstructionPlan')
      .set('Authorization', 'Bearer totally-bogus-jwt')
      .send({ callerCrew: CREW_1, vars: {} });

    expect(res.status).to.equal(401);
  });

  // ── Input validation ───────────────────────────────────────────

  it('returns 400 for an invalid action name (special chars)', async function () {
    const res = await server
      .post('/v2/actions/not-valid!')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ vars: {} });

    expect(res.status).to.equal(400);
    expect(res.text).to.include('Invalid action name');
  });

  it('returns 400 when callerCrew is not an object', async function () {
    const res = await server
      .post('/v2/actions/ConstructionPlan')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ callerCrew: [1, 2], vars: {} });

    expect(res.status).to.equal(400);
    expect(res.body.error || res.text).to.include('callerCrew must be an object');
  });

  it('returns 400 when vars is a string', async function () {
    const res = await server
      .post('/v2/actions/ConstructionPlan')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ callerCrew: CREW_1, vars: 'bad' });

    expect(res.status).to.equal(400);
    expect(res.body.error || res.text).to.include('vars must be an object');
  });

  it('returns 400 when meta is an array', async function () {
    const res = await server
      .post('/v2/actions/ConstructionPlan')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ callerCrew: CREW_1, vars: {}, meta: [1] });

    expect(res.status).to.equal(400);
    expect(res.body.error || res.text).to.include('meta must be an object');
  });

  it('returns 400 for an unknown action name', async function () {
    const res = await postAction(server, TOKEN, 'TotallyFakeAction', {
      caller_crew: CREW_1
    });

    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('Unknown action');
  });

  // ── Successful request ─────────────────────────────────────────

  it('returns 200 for a valid action request', async function () {
    // Use ConstructionAbandon on a PLANNED building — first set one up
    await mongoose.model('BuildingComponent').updateOne(
      { 'entity.id': WAREHOUSE.id, 'entity.label': 5 },
      { $set: { status: 1 } } // PLANNED
    );

    // Empty site inventory so abandon check passes
    const origInv = await mongoose.model('InventoryComponent').findOne({
      'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1
    }).lean();
    await mongoose.model('InventoryComponent').updateOne(
      { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
      { $set: { contents: [], mass: 0, volume: 0 } }
    );

    const res = await postAction(server, TOKEN, 'ConstructionAbandon', {
      caller_crew: CREW_1,
      building: WAREHOUSE
    });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('event');

    // Restore inventory and status
    if (origInv) {
      await mongoose.model('InventoryComponent').updateOne(
        { 'entity.id': WAREHOUSE.id, 'entity.label': 5, slot: 1 },
        { $set: { contents: origInv.contents, mass: origInv.mass, volume: origInv.volume } }
      );
    }
    await mongoose.model('BuildingComponent').updateOne(
      { 'entity.id': WAREHOUSE.id, 'entity.label': 5 },
      { $set: { status: 3 } } // OPERATIONAL
    );
  });

  // ── Wrong owner ────────────────────────────────────────────────

  it('returns 400 when caller does not control the crew', async function () {
    const res = await postAction(server, WRONG_TOKEN, 'ConstructionPlan', {
      caller_crew: CREW_1,
      building_type: 1,
      lot: { id: 99999 }
    });

    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('Not authorized');
  });

  // ── Idempotency ────────────────────────────────────────────────

  describe('X-Idempotency-Key', function () {
    it('replays the cached event when the same key + body is sent twice', async function () {
      // Pick an action with no external state dependencies. ChangeName is simple.
      const idem = `idem-${Date.now()}`;
      const vars = { caller_crew: CREW_1, entity: CREW_1, name: 'TestCrewName' };

      const first = await server
        .post('/v2/actions/ChangeName')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Idempotency-Key', idem)
        .send({ callerCrew: CREW_1, vars });
      expect(first.status).to.equal(200);
      const firstTx = first.body.event.transactionHash;

      const second = await server
        .post('/v2/actions/ChangeName')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Idempotency-Key', idem)
        .send({ callerCrew: CREW_1, vars });
      expect(second.status).to.equal(200);
      expect(second.body.replayed).to.equal(true);
      expect(second.body.event.transactionHash).to.equal(firstTx);
    });

    it('does NOT replay when the same key is reused with a different body', async function () {
      // Controller binds the key to a sha256 of action + payload, so the
      // second call goes through as a fresh action instead of being treated
      // as a replay of the first.
      const idem = `idem-diff-${Date.now()}`;

      const first = await server
        .post('/v2/actions/ChangeName')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Idempotency-Key', idem)
        .send({ callerCrew: CREW_1, vars: { caller_crew: CREW_1, entity: CREW_1, name: 'NameA' } });
      expect(first.status).to.equal(200);

      const second = await server
        .post('/v2/actions/ChangeName')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Idempotency-Key', idem)
        .send({ callerCrew: CREW_1, vars: { caller_crew: CREW_1, entity: CREW_1, name: 'NameB' } });
      expect(second.status).to.equal(200);
      expect(second.body.replayed).to.not.equal(true);
      expect(second.body.event.transactionHash).to.not.equal(first.body.event.transactionHash);
    });
  });

  // ── Shape fuzzing ──────────────────────────────────────────────

  it('does not accept `$`-prefixed keys that would inject into mongo filters', async function () {
    // caller_crew shape check + handler's targeted id extraction rejects
    // anything except a plain `{id, label}` ref, so a filter-injection
    // payload just 400s.
    const res = await postAction(server, TOKEN, 'ConstructionPlan', {
      caller_crew: { $gt: {} },
      building_type: 1,
      lot: { id: 99999 }
    });
    expect(res.status).to.equal(400);
  });

  it('ignores __proto__ keys inside vars without polluting prototype', async function () {
    const poison = JSON.parse('{"caller_crew":{"__proto__":{"polluted":true}}}');
    await postAction(server, TOKEN, 'ConstructionPlan', poison);
    // Object prototype should be clean regardless of the handler's response.
    // eslint-disable-next-line no-proto
    expect(({}).polluted).to.be.undefined;
    expect(Object.prototype.polluted).to.be.undefined;
  });
});
