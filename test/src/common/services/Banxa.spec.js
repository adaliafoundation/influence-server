const { expect } = require('chai');
const axios = require('axios');
const crypto = require('crypto');
const appConfig = require('config');
const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const { BanxaService } = require('@common/services');
const starknetClient = require('@common/lib/starknet/client');

const signWebhook = (payload) => {
  const nonce = '1785804345837761';
  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', appConfig.get('Banxa.webhookSecret'))
    .update(`POST\n/v2/banxa/webhook\n${nonce}\n${rawBody}`)
    .digest('hex');

  return {
    authorization: `Bearer ${appConfig.get('Banxa.webhookApiKey')}:${signature}:${nonce}`,
    rawBody
  };
};

const expectReject = async (promise, message) => {
  try {
    await promise;
  } catch (error) {
    expect(error.message).to.equal(message);
    return;
  }
  throw new Error(`Expected rejection: ${message}`);
};

describe('BanxaService', function () {
  beforeEach(async function () {
    await this.utils.resetCollections(['BanxaOrder']);
  });

  const checkoutBody = (walletAddress, overrides = {}) => ({
    crypto: 'USDC',
    fiat: 'EUR',
    fiatAmount: '25',
    returnUrl: 'https://client.local/banxa/return',
    walletAddress,
    ...overrides
  });

  it('should create Banxa checkout orders for deployed authenticated wallets', async function () {
    const storedUserAddress = Address.toStandard(this.GLOBALS.user.address);
    const starknetUserAddress = Address.toStandard(this.GLOBALS.user.address, 'starknet');
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().resolves({})
    });
    const postStub = this._sandbox.stub(axios, 'post').resolves({
      data: {
        blockchain: 'STARKNET',
        checkoutUrl: 'https://checkout.banxa.local/order',
        crypto: 'USDC',
        externalOrderId: 'external_123',
        fiat: 'EUR',
        fiatAmount: '25.00',
        id: 'banxa_123'
      }
    });

    const order = await BanxaService.createCheckout({
      body: checkoutBody(this.GLOBALS.user.address, { blockchain: 'STARKNET' }),
      userAddress: this.GLOBALS.user.address
    });

    expect(order.orderId).to.equal('banxa_123');
    expect(order.checkoutUrl).to.equal('https://checkout.banxa.local/order');
    expect(order.walletAddress).to.equal(storedUserAddress);
    expect(postStub.calledOnce).to.equal(true);
    expect(postStub.firstCall.args[0]).to.equal('https://banxa.localhost/test-partner/v2/buy');
    expect(postStub.firstCall.args[1]).to.include({
      blockchain: 'STARKNET',
      crypto: 'USDC',
      externalCustomerId: starknetUserAddress,
      fiat: 'EUR',
      fiatAmount: '25',
      redirectUrl: 'https://client.local/banxa/return',
      walletAddress: starknetUserAddress
    });
    expect(postStub.firstCall.args[2].headers['x-api-key']).to.equal(appConfig.get('Banxa.apiKey'));

    const persisted = await mongoose.model('BanxaOrder').findOne({ banxaOrderId: 'banxa_123' }).lean();
    expect(Boolean(persisted)).to.equal(true);
    expect(persisted.status).to.equal('checkout_created');
  });

  it('should reject checkouts for undeployed wallets', async function () {
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().rejects(new Error('Requested contract address is not deployed'))
    });

    await expectReject(BanxaService.createCheckout({
      body: checkoutBody(this.GLOBALS.user.address),
      userAddress: this.GLOBALS.user.address
    }), 'Wallet must be deployed before Banxa checkout');
  });

  it('should reject checkouts for a different wallet address', async function () {
    await expectReject(BanxaService.createCheckout({
      body: checkoutBody('0x456'),
      userAddress: this.GLOBALS.user.address
    }), 'Wallet address must match authenticated user');
  });

  it('should update order status from signed Banxa webhooks', async function () {
    await mongoose.model('BanxaOrder').create({
      banxaOrderId: 'banxa_123',
      checkoutUrl: 'https://checkout.banxa.local/order',
      crypto: 'USDC',
      externalOrderId: 'external_123',
      fiat: 'EUR',
      fiatAmount: '25',
      userAddress: this.GLOBALS.user.address,
      walletAddress: this.GLOBALS.user.address
    });
    const payload = { order_id: 'banxa_123', status: 'complete' };
    const { authorization, rawBody } = signWebhook(payload);

    const order = await BanxaService.updateOrderFromWebhook({ authorization, payload, rawBody });

    expect(order.status).to.equal('completed');
    const persisted = await mongoose.model('BanxaOrder').findOne({ banxaOrderId: 'banxa_123' }).lean();
    expect(persisted.rawWebhookEvents).to.have.length(1);
  });

  it('should refresh order status from Banxa order lookup', async function () {
    await mongoose.model('BanxaOrder').create({
      banxaOrderId: 'banxa_123',
      checkoutUrl: 'https://checkout.banxa.local/order',
      crypto: 'USDC',
      externalOrderId: 'external_123',
      fiat: 'EUR',
      fiatAmount: '25',
      userAddress: this.GLOBALS.user.address,
      walletAddress: this.GLOBALS.user.address
    });
    const getStub = this._sandbox.stub(axios, 'get').resolves({
      data: {
        crypto: { blockchain: 'STARKNET', id: 'USDC' },
        cryptoAmount: '24.12',
        fiat: 'EUR',
        fiatAmount: '25.00',
        id: 'banxa_123',
        status: 'complete'
      }
    });

    const order = await BanxaService.orderForUser({
      orderId: 'banxa_123',
      userAddress: this.GLOBALS.user.address
    });

    expect(order.status).to.equal('completed');
    expect(order.cryptoAmount).to.equal('24.12');
    expect(order.blockchain).to.equal('STARKNET');
    expect(getStub.calledOnce).to.equal(true);
    expect(getStub.firstCall.args[0]).to.equal('https://banxa.localhost/test-partner/v2/orders/banxa_123');
    expect(getStub.firstCall.args[1].headers['x-api-key']).to.equal(appConfig.get('Banxa.apiKey'));
  });

  it('should reject Banxa webhooks with invalid signatures', async function () {
    await expectReject(BanxaService.updateOrderFromWebhook({
      authorization: `Bearer ${appConfig.get('Banxa.webhookApiKey')}:bad:1785804345837761`,
      payload: { order_id: 'banxa_123', status: 'complete' },
      rawBody: '{"order_id":"banxa_123","status":"complete"}'
    }), 'Invalid Banxa webhook signature');
  });
});
