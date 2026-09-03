const { expect } = require('chai');
const appConfig = require('config');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const Entity = require('@common/lib/Entity');
const starknetClient = require('@common/lib/starknet/client');
const CrewmatePurchaseService = require('@common/services/CrewmatePurchase');

const validGrantRequest = () => ({
  body: 4,
  callerCrew: { label: 1, id: 42 },
  class: 2,
  clothes: 9,
  cosmetic: [11, 12, 13],
  face: 5,
  gender: 3,
  hair: 6,
  hairColor: 7,
  impactful: [10],
  name: 'Ada',
  recipient: '0x789',
  restrictedUntil: 100,
  station: { label: 5, id: 1 }
});

describe('CrewmatePurchaseService', function () {
  beforeEach(function () {
    appConfig.Contracts.starknet.dispatcher = '0x456';
    appConfig.Contracts.starknet.starterPackAdmin = '0x123';
    appConfig.Starknet.starterPackPrivateKey = '0xabc';
    appConfig.Starknet.starterPackPrivateKeyFile = null;
    appConfig.Stripe.checkoutPaymentMethodTypes = ['card', 'ideal'];
    appConfig.Stripe.crewmateProduct = { stripeProductId: 'prod_crewmate' };
  });

  afterEach(function () {
    return this.utils.resetCollections(['CrewmatePurchase', 'NftComponent']);
  });

  it('should return Stripe-managed product presentation', async function () {
    const stripe = {
      prices: {
        retrieve: this._sandbox.stub().resolves({ active: true, currency: 'eur', id: 'price_1', unit_amount: 1500 })
      },
      products: {
        retrieve: this._sandbox.stub().resolves({
          active: true,
          default_price: 'price_1',
          description: 'One customized Adalian',
          id: 'prod_crewmate',
          marketing_features: [{ name: 'Restricted for 14 days' }],
          name: 'Crewmate'
        })
      }
    };

    const [product] = await CrewmatePurchaseService.listProducts({ stripe });
    expect(product).to.deep.include({
      amount: 1500,
      currency: 'eur',
      description: 'One customized Adalian',
      enabled: true,
      name: 'Crewmate',
      productId: 'prod_crewmate',
      requiredCrewmates: 1,
      stripePriceId: 'price_1'
    });
    expect(product.features).to.deep.equal(['Restricted for 14 days']);
  });

  it('should create an embedded Checkout session and durable purchase', async function () {
    const stripe = {
      checkout: { sessions: { create: this._sandbox.stub().resolves({ client_secret: 'secret', id: 'cs_1' }) } },
      prices: { retrieve: this._sandbox.stub().resolves({ active: true, id: 'price_1' }) },
      products: {
        retrieve: this._sandbox.stub().resolves({ active: true, default_price: 'price_1', id: 'prod_crewmate' })
      }
    };

    const result = await CrewmatePurchaseService.createCheckoutSession({
      productId: 'prod_crewmate',
      purchaser: '0x789',
      recipient: '0x789',
      returnUrl: 'https://example.com/return?session_id={CHECKOUT_SESSION_ID}',
      stripe
    });

    expect(result).to.deep.include({ clientSecret: 'secret', id: 'cs_1' });
    expect(result.purchase).to.deep.include({
      canCustomize: false,
      productId: 'prod_crewmate',
      requiredCrewmates: 1,
      status: 'checkout_created'
    });
    expect(stripe.checkout.sessions.create.firstCall.args[0].metadata).to.deep.include({
      purchaseType: 'crewmate',
      recipient: '0x0000000000000000000000000000000000000789'
    });
  });

  it('should only mark a checkout paid after Stripe confirms payment and product', async function () {
    const purchase = await mongoose.model('CrewmatePurchase').create({
      purchaser: '0x789',
      recipient: '0x789',
      stripeCheckoutSessionId: 'cs_1',
      stripePriceId: 'price_1',
      stripeProductId: 'prod_crewmate'
    });
    const event = {
      id: 'evt_1',
      data: { object: { id: 'cs_1', metadata: { purchaseId: purchase.id }, payment_status: 'paid' } }
    };
    const stripe = {
      checkout: {
        sessions: {
          listLineItems: this._sandbox.stub().resolves({ data: [{ price: { product: 'prod_crewmate' } }] })
        }
      }
    };

    const result = await CrewmatePurchaseService.handleCheckoutSessionCompleted({ event, stripe });
    expect(result.status).to.equal('paid_pending_customization');
    expect(result.paidAt).to.be.a('date');
  });

  it('should reject invalid customization lengths', function () {
    const request = validGrantRequest();
    request.cosmetic = [1, 2];
    expect(() => CrewmatePurchaseService.validateGrantRequest(request)).to.throw('Invalid cosmetic length');
  });

  it('should flatten GrantOffchainCrewmate calldata in contract order', function () {
    const calldata = CrewmatePurchaseService.calldataFromPurchase({
      externalRef: '0xabc',
      grantRequest: validGrantRequest()
    });

    expect(calldata).to.deep.equal([
      '0x0000000000000000000000000000000000000000000000000000000000000789',
      '0xabc',
      100,
      5,
      1,
      1,
      42,
      2,
      1,
      10,
      3,
      11,
      12,
      13,
      3,
      4,
      5,
      6,
      7,
      9,
      shortString.encodeShortString('Ada')
    ]);
  });

  it('should submit through Dispatcher.run_system', async function () {
    const execute = this._sandbox.stub().resolves({ transaction_hash: '0xtx' });
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({});
    this._sandbox.stub(starknetClient, 'createAccount').returns({ execute });
    const purchase = {
      externalRef: '0xabc',
      grantRequest: validGrantRequest(),
      save: this._sandbox.stub().resolves(),
      status: 'paid_pending_customization'
    };

    expect(await CrewmatePurchaseService.submitGrant(purchase)).to.equal('0xtx');
    const call = execute.firstCall.args[0];
    expect(call.contractAddress).to.equal('0x456');
    expect(call.entrypoint).to.equal('run_system');
    expect(call.calldata[0]).to.equal(shortString.encodeShortString('GrantOffchainCrewmate'));
    expect(call.calldata[1]).to.equal(21);
  });

  it('should require indexed ownership of the destination crew before granting', async function () {
    const purchase = await mongoose.model('CrewmatePurchase').create({
      externalRef: '0xabc',
      purchaser: '0x789',
      recipient: '0x789',
      status: 'paid_pending_customization',
      stripeCheckoutSessionId: 'cs_1',
      stripePriceId: 'price_1',
      stripeProductId: 'prod_crewmate'
    });
    await mongoose.model('NftComponent').create({
      entity: Entity.Crew(42),
      owners: { starknet: '0x789' }
    });
    this._sandbox.stub(CrewmatePurchaseService, 'submitGrant').callsFake(async (doc) => {
      await mongoose.model('CrewmatePurchase').updateOne(
        { _id: doc._id },
        { $set: { status: 'grant_submitted', txHash: '0xtx' } }
      );
    });

    const result = await CrewmatePurchaseService.completeGrantRequest({
      grantRequest: validGrantRequest(),
      purchaseId: purchase.id,
      purchaser: '0x789'
    });
    expect(result.status).to.equal('grant_submitted');
    expect(result.txHash).to.equal('0xtx');
  });

  it('should reject customization for a crew owned by another account', async function () {
    const purchase = await mongoose.model('CrewmatePurchase').create({
      externalRef: '0xabc',
      purchaser: '0x789',
      recipient: '0x789',
      status: 'paid_pending_customization',
      stripeCheckoutSessionId: 'cs_1',
      stripePriceId: 'price_1',
      stripeProductId: 'prod_crewmate'
    });
    await mongoose.model('NftComponent').create({
      entity: Entity.Crew(42),
      owners: { starknet: '0x456' }
    });

    let error;
    try {
      await CrewmatePurchaseService.completeGrantRequest({
        grantRequest: validGrantRequest(),
        purchaseId: purchase.id,
        purchaser: '0x789'
      });
    } catch (e) {
      error = e;
    }

    expect(error).to.be.an('error');
    expect(error.message).to.equal('Recipient does not own callerCrew');
  });
});
