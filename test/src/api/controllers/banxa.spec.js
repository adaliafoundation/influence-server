const { expect } = require('chai');
const Koa = require('koa');
const request = require('supertest');
const appConfig = require('config');
const { BanxaService } = require('@common/services');
const banxaController = require('@api/controllers/banxa');

describe('banxa controller', function () {
  afterEach(function () {
    appConfig.Banxa.checkoutEnabled = 1;
    delete require.cache[require.resolve('@api/controllers/banxa')];
  });

  it('should create checkout orders for authenticated users', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { user, userToken } = this.GLOBALS;
    const body = {
      crypto: 'USDC',
      fiat: 'EUR',
      fiatAmount: '25',
      returnUrl: 'https://client.local/banxa/return',
      walletAddress: user.address
    };
    const order = {
      checkoutUrl: 'https://checkout.banxa.local/order',
      orderId: 'banxa_123',
      status: 'checkout_created'
    };
    const createStub = this._sandbox.stub(BanxaService, 'createCheckout').resolves(order);
    app.use(banxaController.routes());

    const response = await server
      .post('/v2/banxa/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send(body);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ order });
    expect(createStub.calledOnceWith({ body, userAddress: user.address })).to.equal(true);
  });

  it('should reject unauthenticated checkout requests', async function () {
    const app = new Koa();
    const server = request(app.callback());
    app.use(banxaController.routes());

    const response = await server
      .post('/v2/banxa/checkout')
      .send({});

    expect(response.status).to.equal(401);
  });

  it('should return authenticated user orders', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { user, userToken } = this.GLOBALS;
    const order = { orderId: 'banxa_123', status: 'pending' };
    const orderStub = this._sandbox.stub(BanxaService, 'orderForUser').resolves(order);
    app.use(banxaController.routes());

    const response = await server
      .get('/v2/banxa/orders/banxa_123')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ order });
    expect(orderStub.calledOnceWith({ orderId: 'banxa_123', userAddress: user.address })).to.equal(true);
  });

  it('should not register routes when Banxa checkout is disabled', async function () {
    appConfig.Banxa.checkoutEnabled = 0;
    delete require.cache[require.resolve('@api/controllers/banxa')];
    // eslint-disable-next-line global-require
    const disabledBanxaController = require('@api/controllers/banxa');
    const app = new Koa();
    const server = request(app.callback());
    app.use(disabledBanxaController.routes());

    const response = await server
      .post('/v2/banxa/checkout')
      .send({});

    expect(response.status).to.equal(404);
  });
});
