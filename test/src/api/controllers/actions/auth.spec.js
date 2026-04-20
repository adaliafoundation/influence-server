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

    const res = await postAction(server, TOKEN, 'ConstructionAbandon', {
      caller_crew: CREW_1,
      building: WAREHOUSE
    });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('event');

    // Restore
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
});
