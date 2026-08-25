const fs = require('fs/promises');
const path = require('path');
const { expect } = require('chai');
const appConfig = require('config');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const StarterPackPurchaseService = require('@common/services/StarterPackPurchase');
const starknetClient = require('@common/lib/starknet/client');

const validGrantRequest = () => ({
  bodies: [1, 2],
  classes: [3, 4],
  clothes: [5, 6],
  cosmetic: [7, 8, 9, 10, 11, 12],
  faces: [13, 14],
  genders: [15, 16],
  hairColors: [17, 18],
  hairs: [19, 20],
  impactful: [21, 22],
  names: ['Ada', 'Bea'],
  recipient: '0x789',
  restrictedUntil: 100,
  station: { label: 5, id: 1 }
});

describe('StarterPackPurchaseService', function () {
  beforeEach(function () {
    appConfig.Contracts.starknet.starterPackAdmin = '0x123';
    appConfig.Contracts.starknet.grantOffchainStarterPack = '0x456';
    appConfig.Starknet.starterPackPrivateKey = '0xabc';
    appConfig.Starknet.starterPackPrivateKeyFile = null;
    appConfig.Stripe.checkoutPaymentMethodTypes = ['card', 'ideal'];
    appConfig.Stripe.starterPackProducts = {
      explorer: { productId: 1, stripeProductId: 'prod_explorer' },
      strategist: { productId: 2, stripeProductId: 'prod_strategist' },
      industrialist: { productId: 3, stripeProductId: 'prod_industrialist' }
    };
  });

  afterEach(function () {
    return this.utils.resetCollections(['StarterPackPurchase']);
  });

  describe('externalRefForCheckoutSession', function () {
    it('should hash a Stripe checkout session id into a felt', function () {
      const externalRef = StarterPackPurchaseService.externalRefForCheckoutSession('cs_test_123');
      expect(externalRef).to.match(/^0x[0-9a-f]+$/);
    });
  });

  describe('validateGrantRequest', function () {
    it('should reject invalid product array lengths', function () {
      expect(() => StarterPackPurchaseService.validateGrantRequest({
        productId: 2,
        grantRequest: {
          bodies: [1, 2],
          classes: [1, 2],
          clothes: [1, 2],
          cosmetic: [1, 2, 3, 4, 5, 6],
          faces: [1, 2],
          genders: [1, 2],
          hairColors: [1, 2],
          hairs: [1, 2],
          impactful: [1, 2],
          names: ['Ada', 'Bea'],
          recipient: '0x123',
          restrictedUntil: 100,
          station: { label: 5, id: 1 }
        }
      })).to.throw('Invalid classes length');
    });
  });

  describe('starterPackProductConfig', function () {
    it('should resolve a configured product by key', function () {
      expect(StarterPackPurchaseService.starterPackProductConfig('explorer')).to.deep.equal({
        productId: 1,
        stripeProductId: 'prod_explorer'
      });
    });

    it('should resolve a configured product by Stripe product id', function () {
      expect(StarterPackPurchaseService.starterPackProductConfig('prod_strategist')).to.deep.equal({
        productId: 2,
        stripeProductId: 'prod_strategist'
      });
    });
  });

  describe('listProducts', function () {
    it('should return client-ready starter pack products', async function () {
      const prices = {
        price_explorer: { active: true, currency: 'usd', id: 'price_explorer', unit_amount: 2500 },
        price_industrialist: { active: true, currency: 'usd', id: 'price_industrialist', unit_amount: 9000 },
        price_strategist: { active: true, currency: 'usd', id: 'price_strategist', unit_amount: 5000 }
      };
      const productsById = {
        prod_explorer: {
          active: true,
          default_price: 'price_explorer',
          description: 'Explorer description',
          id: 'prod_explorer',
          name: 'Explorer'
        },
        prod_industrialist: {
          active: true,
          default_price: 'price_industrialist',
          description: 'Industrialist description',
          id: 'prod_industrialist',
          name: 'Industrialist'
        },
        prod_strategist: {
          active: true,
          default_price: 'price_strategist',
          description: 'Strategist description',
          id: 'prod_strategist',
          name: 'Strategist'
        }
      };
      const stripe = {
        prices: {
          retrieve: this._sandbox.stub().callsFake(async (priceId) => prices[priceId])
        },
        products: {
          retrieve: this._sandbox.stub().callsFake(async (productId) => productsById[productId])
        }
      };

      const products = await StarterPackPurchaseService.listProducts({ stripe });

      expect(products.map((product) => product.packType)).to.deep.equal(['explorer', 'strategist', 'industrialist']);
      expect(products[0]).to.deep.include({
        amount: 2500,
        currency: 'usd',
        enabled: true,
        name: 'Explorer',
        packType: 'explorer',
        productId: 1,
        requiredCrewmates: 2,
        sortOrder: 1
      });
      expect(products[0].buildings).to.deep.equal([
        { id: 1, name: 'Warehouse' },
        { id: 2, name: 'Extractor' }
      ]);
      expect(products[0]).to.not.have.property('features');
      expect(products[0]).to.not.have.property('flavor');
    });
  });

  describe('createCheckoutSession', function () {
    it('should create a durable purchase intent without a grant request', async function () {
      const stripe = {
        checkout: {
          sessions: {
            create: this._sandbox.stub().resolves({ id: 'cs_123', url: 'https://stripe.test/checkout' })
          }
        },
        prices: {
          retrieve: this._sandbox.stub().resolves({ active: true, id: 'price_123' })
        },
        products: {
          retrieve: this._sandbox.stub().resolves({
            active: true,
            default_price: 'price_123',
            id: 'prod_explorer'
          })
        }
      };

      const result = await StarterPackPurchaseService.createCheckoutSession({
        cancelUrl: 'https://example.com/cancel',
        purchaser: '0x789',
        product: 'explorer',
        recipient: '0x789',
        stripe,
        successUrl: 'https://example.com/success'
      });

      const purchase = await mongoose.model('StarterPackPurchase').findById(result.purchaseId).lean();
      expect(result).to.deep.include({ id: 'cs_123', url: 'https://stripe.test/checkout' });
      expect(result.purchase).to.deep.include({
        canCustomize: false,
        packType: 'explorer',
        productId: 1,
        requiredCrewmates: 2,
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_123'
      });
      expect(purchase.status).to.equal('checkout_created');
      expect(purchase.grantRequest).to.equal(undefined);
      expect(purchase.recipient).to.equal('0x0000000000000000000000000000000000000789');
      expect(stripe.checkout.sessions.create.firstCall.args[0].metadata).to.deep.include({
        purchaseId: result.purchaseId,
        productId: 1,
        recipient: '0x0000000000000000000000000000000000000789'
      });
    });

    it('should reject purchases for a different recipient', async function () {
      let error;
      try {
        await StarterPackPurchaseService.createCheckoutSession({
          cancelUrl: 'https://example.com/cancel',
          purchaser: '0x789',
          product: 'explorer',
          recipient: '0xabc',
          stripe: {},
          successUrl: 'https://example.com/success'
        });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');
      expect(error.message).to.equal('Recipient must match purchaser');
    });
  });

  describe('purchaseForCheckoutSession', function () {
    it('should find a purchase by checkout session for the purchaser', async function () {
      await mongoose.model('StarterPackPurchase').create({
        productId: 1,
        purchaser: '0x789',
        recipient: '0x789',
        status: 'paid_pending_customization',
        stripeCheckoutSessionId: 'cs_123',
        stripePriceId: 'price_123',
        stripeProductId: 'prod_explorer'
      });

      const result = await StarterPackPurchaseService.purchaseForCheckoutSession({
        checkoutSessionId: 'cs_123',
        purchaser: '0x789'
      });

      expect(result).to.deep.include({
        canCustomize: true,
        packType: 'explorer',
        productId: 1,
        requiredCrewmates: 2,
        status: 'paid_pending_customization',
        stripeCheckoutSessionId: 'cs_123'
      });
    });
  });

  describe('calldataFromPurchase', function () {
    it('should flatten the grant calldata', function () {
      const calldata = StarterPackPurchaseService.calldataFromPurchase({
        externalRef: '0xabc',
        productId: 1,
        grantRequest: validGrantRequest()
      });

      expect(calldata.slice(0, 6)).to.deep.equal([
        '0x0000000000000000000000000000000000000000000000000000000000000789',
        '0xabc',
        1,
        100,
        5,
        1
      ]);
      expect(calldata).to.include(shortString.encodeShortString('Ada'));
      expect(calldata).to.include('0x0000000000000000000000000000000000000000000000000000000000000123');
    });
  });

  describe('submitGrant', function () {
    it('should submit and persist the transaction hash', async function () {
      const executeStub = this._sandbox.stub().resolves({ transaction_hash: '0xtx' });
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({});
      this._sandbox.stub(starknetClient, 'createAccount').returns({ execute: executeStub });

      const purchase = {
        externalRef: '0xabc',
        productId: 1,
        status: 'paid_pending_customization',
        grantRequest: validGrantRequest(),
        save: this._sandbox.stub().resolves()
      };

      const txHash = await StarterPackPurchaseService.submitGrant(purchase);

      expect(txHash).to.equal('0xtx');
      expect(purchase.status).to.equal('grant_submitted');
      expect(purchase.txHash).to.equal('0xtx');
      expect(executeStub.calledOnce).to.equal(true);
    });

    it('should prefer the configured private key file', async function () {
      const keyFile = path.join('/tmp', `starter-pack-key-${process.pid}`);
      await fs.writeFile(keyFile, '0xfilekey\n');
      appConfig.Starknet.starterPackPrivateKey = '0xenvkey';
      appConfig.Starknet.starterPackPrivateKeyFile = keyFile;

      const executeStub = this._sandbox.stub().resolves({ transaction_hash: '0xtx' });
      const createAccountStub = this._sandbox.stub(starknetClient, 'createAccount').returns({ execute: executeStub });
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({});

      const purchase = {
        externalRef: '0xabc',
        productId: 1,
        status: 'paid_pending_customization',
        grantRequest: validGrantRequest(),
        save: this._sandbox.stub().resolves()
      };

      await StarterPackPurchaseService.submitGrant(purchase);
      await fs.unlink(keyFile);

      expect(createAccountStub.firstCall.args[0].signer).to.equal('0xfilekey');
    });
  });

  describe('handleCheckoutSessionCompleted', function () {
    it('should not mark unpaid delayed checkout sessions as paid', async function () {
      const purchase = await mongoose.model('StarterPackPurchase').create({
        grantRequest: {
          recipient: '0x789',
          restrictedUntil: 100,
          station: { label: 5, id: 1 }
        },
        productId: 1,
        purchaser: '0x789',
        recipient: '0x789',
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_123',
        stripePriceId: 'price_123',
        stripeProductId: 'prod_explorer'
      });

      const result = await StarterPackPurchaseService.handleCheckoutSessionCompleted({
        event: {
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_123',
              metadata: { purchaseId: purchase.id },
              payment_status: 'unpaid'
            }
          }
        },
        stripe: {}
      });

      const updatedPurchase = await mongoose.model('StarterPackPurchase').findById(purchase.id).lean();
      expect(result).to.equal(null);
      expect(updatedPurchase.status).to.equal('checkout_created');
      expect(updatedPurchase.stripeEventIds).to.deep.equal(['evt_123']);
    });

    it('should mark paid checkout sessions as pending customization without submitting a grant', async function () {
      const purchase = await mongoose.model('StarterPackPurchase').create({
        productId: 1,
        purchaser: '0x789',
        recipient: '0x789',
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_123',
        stripePriceId: 'price_123',
        stripeProductId: 'prod_explorer'
      });

      const submitGrantStub = this._sandbox.stub(StarterPackPurchaseService, 'submitGrant');
      const result = await StarterPackPurchaseService.handleCheckoutSessionCompleted({
        event: {
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_123',
              metadata: { purchaseId: purchase.id },
              payment_status: 'paid'
            }
          }
        },
        stripe: {
          checkout: {
            sessions: {
              listLineItems: this._sandbox.stub().resolves({
                data: [{ price: { product: 'prod_explorer' } }]
              })
            }
          }
        }
      });

      const updatedPurchase = await mongoose.model('StarterPackPurchase').findById(purchase.id).lean();
      expect(result.status).to.equal('paid_pending_customization');
      expect(updatedPurchase.status).to.equal('paid_pending_customization');
      expect(updatedPurchase.grantRequest).to.equal(undefined);
      expect(submitGrantStub.called).to.equal(false);
    });
  });

  describe('completeGrantRequest', function () {
    it('should persist customization and submit the grant for a paid purchase', async function () {
      const purchase = await mongoose.model('StarterPackPurchase').create({
        externalRef: '0xabc',
        productId: 1,
        purchaser: '0x789',
        recipient: '0x789',
        status: 'paid_pending_customization',
        stripeCheckoutSessionId: 'cs_123',
        stripePriceId: 'price_123',
        stripeProductId: 'prod_explorer'
      });
      const submitGrantStub = this._sandbox.stub(StarterPackPurchaseService, 'submitGrant').callsFake(async (doc) => {
        await mongoose.model('StarterPackPurchase').updateOne(
          { _id: doc._id },
          { $set: { status: 'grant_submitted', txHash: '0xtx' } }
        );
        return '0xtx';
      });

      const result = await StarterPackPurchaseService.completeGrantRequest({
        grantRequest: validGrantRequest(),
        purchaseId: purchase.id,
        purchaser: '0x789'
      });

      const updatedPurchase = await mongoose.model('StarterPackPurchase').findById(purchase.id).lean();
      expect(result.status).to.equal('grant_submitted');
      expect(result.txHash).to.equal('0xtx');
      expect(updatedPurchase.grantRequest.names).to.deep.equal(['Ada', 'Bea']);
      expect(submitGrantStub.calledOnce).to.equal(true);
    });

    it('should reject completion before Stripe has confirmed payment', async function () {
      const purchase = await mongoose.model('StarterPackPurchase').create({
        productId: 1,
        purchaser: '0x789',
        recipient: '0x789',
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_123',
        stripePriceId: 'price_123',
        stripeProductId: 'prod_explorer'
      });

      let error;
      try {
        await StarterPackPurchaseService.completeGrantRequest({
          grantRequest: validGrantRequest(),
          purchaseId: purchase.id,
          purchaser: '0x789'
        });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');
      expect(error.message).to.equal('Payment not completed');
    });
  });
});
