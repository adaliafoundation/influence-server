const { expect } = require('chai');
const Koa = require('koa');
const request = require('supertest');
const appConfig = require('config');
const { CrewmatePurchaseService } = require('@common/services');

const loadController = () => {
  delete require.cache[require.resolve('@api/controllers/crewmatePurchases')];
  // eslint-disable-next-line global-require
  return require('@api/controllers/crewmatePurchases');
};

describe('crewmate purchases controller', function () {
  beforeEach(function () {
    appConfig.Crewmate.provisionerEnabled = 1;
  });

  afterEach(function () {
    appConfig.Crewmate.provisionerEnabled = 0;
    delete require.cache[require.resolve('@api/controllers/crewmatePurchases')];
  });

  it('should create checkout sessions for authenticated users', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { user, userToken } = this.GLOBALS;
    const purchase = { id: 'purchase_1', status: 'checkout_created' };
    const create = this._sandbox.stub(CrewmatePurchaseService, 'createCheckoutSession').resolves({
      clientSecret: 'secret',
      id: 'cs_1',
      purchase
    });
    app.use(loadController().routes());

    const response = await server
      .post('/v2/crewmate-purchases/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: 'prod_1', returnUrl: 'https://example.com/return' });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      checkoutSessionId: 'cs_1',
      clientSecret: 'secret',
      purchase
    });
    expect(create.firstCall.args[0]).to.deep.include({
      productId: 'prod_1',
      purchaser: user.address,
      returnUrl: 'https://example.com/return'
    });
  });

  it('should submit customization for an authenticated purchase', async function () {
    const app = new Koa();
    const server = request(app.callback());
    const { user, userToken } = this.GLOBALS;
    const grantRequest = { name: 'Ada' };
    const complete = this._sandbox.stub(CrewmatePurchaseService, 'completeGrantRequest')
      .resolves({ id: 'purchase_1', status: 'grant_submitted' });
    app.use(loadController().routes());

    const response = await server
      .post('/v2/crewmate-purchases/customization')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ grantRequest, purchaseId: 'purchase_1' });

    expect(response.status).to.equal(200);
    expect(response.body.purchase.status).to.equal('grant_submitted');
    expect(complete.calledOnceWithExactly({
      grantRequest,
      purchaseId: 'purchase_1',
      purchaser: user.address
    })).to.equal(true);
  });

  it('should reject unauthenticated checkout requests', async function () {
    const app = new Koa();
    const server = request(app.callback());
    app.use(loadController().routes());

    const response = await server.post('/v2/crewmate-purchases/checkout').send({});
    expect(response.status).to.equal(401);
  });

  it('should not register routes when crewmate provisioning is disabled', async function () {
    appConfig.Crewmate.provisionerEnabled = 0;
    const app = new Koa();
    const server = request(app.callback());
    app.use(loadController().routes());

    const response = await server.post('/v2/crewmate-purchases/checkout').send({});
    expect(response.status).to.equal(404);
  });
});
