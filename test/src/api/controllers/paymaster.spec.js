const { expect } = require('chai');
const Koa = require('koa');
const request = require('supertest');
const appConfig = require('config');
const { AvnuPaymasterService } = require('@common/services');
const paymasterController = require('@api/controllers/paymaster');

describe('paymaster controller', function () {
  afterEach(function () {
    appConfig.Avnu.paymasterEnabled = 1;
    delete require.cache[require.resolve('@api/controllers/paymaster')];
  });

  it('should proxy authenticated JSON-RPC requests', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { user, userToken } = this.GLOBALS;
    const body = {
      id: 1,
      jsonrpc: '2.0',
      method: 'paymaster_buildTransaction',
      params: {
        parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
        transaction: {
          invoke: { calls: [], user_address: user.address },
          type: 'invoke'
        }
      }
    };
    const result = { id: 1, jsonrpc: '2.0', result: { type: 'invoke' } };
    const forwardStub = this._sandbox.stub(AvnuPaymasterService, 'forward').resolves({ data: result, status: 200 });
    app.use(paymasterController.routes());

    const response = await server
      .post('/v2/paymaster')
      .set('Authorization', `Bearer ${userToken}`)
      .send(body);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(result);
    expect(forwardStub.calledOnceWith({ body, userAddress: user.address })).to.equal(true);
  });

  it('should reject unauthenticated requests', async function () {
    const app = new Koa();
    const server = request(app.callback());
    app.use(paymasterController.routes());

    const response = await server
      .post('/v2/paymaster')
      .send({ id: 1, jsonrpc: '2.0', method: 'paymaster_isAvailable' });

    expect(response.status).to.equal(401);
  });

  it('should preserve AVNU error responses', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { userToken } = this.GLOBALS;
    const result = {
      error: { code: -32000, message: 'Sponsorship unavailable' },
      id: 2,
      jsonrpc: '2.0'
    };
    this._sandbox.stub(AvnuPaymasterService, 'forward').resolves({ data: result, status: 429 });
    app.use(paymasterController.routes());

    const response = await server
      .post('/v2/paymaster')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ id: 2, jsonrpc: '2.0', method: 'paymaster_isAvailable' });

    expect(response.status).to.equal(429);
    expect(response.body).to.deep.equal(result);
  });

  it('should not register routes when the paymaster feature is disabled', async function () {
    appConfig.Avnu.paymasterEnabled = 0;
    delete require.cache[require.resolve('@api/controllers/paymaster')];
    // eslint-disable-next-line global-require
    const disabledPaymasterController = require('@api/controllers/paymaster');
    const app = new Koa();
    const server = request(app.callback());
    app.use(disabledPaymasterController.routes());

    const response = await server
      .post('/v2/paymaster')
      .send({ id: 1, jsonrpc: '2.0', method: 'paymaster_isAvailable' });

    expect(response.status).to.equal(404);
  });
});
