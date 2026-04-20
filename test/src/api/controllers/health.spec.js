const { expect } = require('chai');
const request = require('supertest');
const http = require('http');
const mongoose = require('mongoose');
const Koa = require('koa');
const healthRouter = require('@api/controllers/health');
const { isHybrid } = require('@common/lib/gameMode');

describe('GET /v2/health', function () {
  let server;

  beforeEach(async function () {
    // In hybrid mode, seed a WorldFork so the health check passes
    if (isHybrid()) {
      await mongoose.model('WorldFork').findOneAndUpdate(
        {},
        {
          blockNumber: 0,
          blockHash: '0x0',
          blockTimestamp: new Date(),
          forkedAt: new Date(),
          label: 'test'
        },
        { upsert: true }
      );
    }

    const app = new Koa();
    app.use(healthRouter.routes());
    server = request(http.createServer(app.callback()));
  });

  afterEach(async function () {
    if (isHybrid()) {
      await mongoose.model('WorldFork').deleteMany({});
    }
  });

  it('should return 200 when MongoDB is connected', async function () {
    const res = await server.get('/v2/health').expect(200);
    expect(res.body.status).to.equal('ok');
  });

  it('should include mongodb check', async function () {
    const res = await server.get('/v2/health');
    expect(res.body.checks.mongodb).to.have.property('status', 'ok');
    expect(res.body.checks.mongodb).to.have.property('readyState', 1);
  });

  it('should include gameMode check', async function () {
    const res = await server.get('/v2/health');
    expect(res.body.checks.gameMode).to.have.property('mode');
    expect(res.body.checks.gameMode).to.have.property('hybrid');
  });

  it('should include elasticsearch check', async function () {
    const res = await server.get('/v2/health');
    expect(res.body.checks.elasticsearch).to.have.property('status');
  });

  if (isHybrid()) {
    it('should include worldFork check in hybrid mode', async function () {
      const res = await server.get('/v2/health');
      expect(res.body.checks.worldFork).to.have.property('status', 'ok');
    });

    it('should return 503 when WorldFork is missing in hybrid mode', async function () {
      await mongoose.model('WorldFork').deleteMany({});
      const res = await server.get('/v2/health').expect(503);
      expect(res.body.status).to.equal('degraded');
      expect(res.body.checks.worldFork).to.have.property('status', 'missing');
    });
  }
});
