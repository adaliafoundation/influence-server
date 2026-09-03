const { expect } = require('chai');
const Koa = require('koa');
const request = require('supertest');
const appConfig = require('config');
const Stripe = require('stripe');
const { CrewmatePurchaseService, StarterPackPurchaseService } = require('@common/services');

const loadController = () => {
  delete require.cache[require.resolve('@api/controllers/stripe')];
  // eslint-disable-next-line global-require
  return require('@api/controllers/stripe');
};

describe('stripe controller', function () {
  beforeEach(function () {
    appConfig.Contracts.starknet.dispatcher = '0x456';
    appConfig.Contracts.starknet.starterPackAdmin = '0x123';
    appConfig.Crewmate.provisionerEnabled = 1;
    appConfig.StarterPack.provisionerEnabled = 0;
    appConfig.Starknet.rpcProvider = 'https://starknet.local';
    appConfig.Starknet.starterPackPrivateKey = '0xabc';
    appConfig.Stripe.crewmateProduct = { stripeProductId: 'prod_crewmate' };
    appConfig.Stripe.secretKey = 'sk_test_123';
    appConfig.Stripe.webhookSecret = 'whsec_test_123';
  });

  afterEach(function () {
    appConfig.Crewmate.provisionerEnabled = 0;
    delete require.cache[require.resolve('@api/controllers/stripe')];
  });

  it('should route crewmate checkout completion to the crewmate purchase service', async function () {
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { purchaseType: 'crewmate' } } }
    };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: appConfig.Stripe.webhookSecret
    });
    const crewmateHandler = this._sandbox
      .stub(CrewmatePurchaseService, 'handleCheckoutSessionCompleted').resolves();
    const starterPackHandler = this._sandbox
      .stub(StarterPackPurchaseService, 'handleCheckoutSessionCompleted').resolves();
    const app = new Koa();
    const server = request(app.callback());
    app.use(loadController().routes());

    const response = await server
      .post('/v2/stripe/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payload);

    expect(response.status).to.equal(200);
    expect(crewmateHandler.calledOnce).to.equal(true);
    expect(crewmateHandler.firstCall.args[0].event).to.deep.equal(event);
    expect(starterPackHandler.called).to.equal(false);
  });

  it('should ignore checkout events for disabled purchase types', async function () {
    const event = {
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: { metadata: { purchaseType: 'starter_pack' } } }
    };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: appConfig.Stripe.webhookSecret
    });
    const starterPackHandler = this._sandbox
      .stub(StarterPackPurchaseService, 'handleCheckoutSessionCompleted').resolves();
    const app = new Koa();
    const server = request(app.callback());
    app.use(loadController().routes());

    const response = await server
      .post('/v2/stripe/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payload);

    expect(response.status).to.equal(200);
    expect(starterPackHandler.called).to.equal(false);
  });
});
