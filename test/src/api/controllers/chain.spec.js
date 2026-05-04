const { expect } = require('chai');
const mongoose = require('mongoose');
const Koa = require('koa');
const request = require('supertest');
const { StarknetBlockCache } = require('@common/lib/cache');
const chainController = require('@api/controllers/chain');

describe('chain controller', function () {
  it('should return l1AcceptedBlock using the new auditor-managed checkpoint', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const collection = mongoose.connection.collection('keyv');
    app.use(chainController.routes());

    await StarknetBlockCache.setLastAuditedFinalizedBlock(200);

    const response = await server
      .get('/v2/chain')
      .set('Origin', 'http://localhost.local');

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ l1AcceptedBlock: 200 });

    await collection.deleteMany({});
  });
});
