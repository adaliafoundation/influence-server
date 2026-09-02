const appConfig = require('config');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Types } = require('mongoose');
const { Address } = require('@influenceth/sdk');
const starknetClient = require('@common/lib/starknet/client');
const { ValidationError } = require('@common/lib/errors');

const isContractNotDeployedError = (error) => /not deployed|contract not found/i.test(error.message || String(error));
const banxaErrorMessage = (error) => {
  if (!error.response) return error.message;

  const body = error.response.data;
  const detail = typeof body === 'string' ? body : JSON.stringify(body);
  return `Banxa API ${error.response.status}: ${detail}`;
};

const requiredConfig = () => [
  ['Banxa.apiKey', appConfig.get('Banxa.apiKey')],
  ['Banxa.baseUrl', appConfig.get('Banxa.baseUrl')],
  ['Banxa.partnerRef', appConfig.get('Banxa.partnerRef')]
];

const banxaStatus = (value) => {
  const status = value?.toString().toLowerCase();
  if (!status) return 'pending';
  if (['coin_transferred', 'complete', 'completed', 'fulfilled', 'success', 'successful'].includes(status)) {
    return 'completed';
  }
  if (['cancelled', 'canceled', 'expired', 'payment_cancelled', 'refunded'].includes(status)) return 'cancelled';
  if (['failed', 'declined', 'payment_declined', 'rejected'].includes(status)) return 'failed';
  return 'pending';
};

const orderStatusFromWebhook = (payload) => banxaStatus(
  payload.status || payload.orderStatus || payload.order?.status || payload.data?.status || payload.data?.order?.status
);

const orderIdFromWebhook = (payload) => (
  payload.orderId || payload.order_id || payload.id || payload.order?.id || payload.data?.id || payload.data?.order?.id
);

const banxaBaseUrl = () => appConfig.get('Banxa.baseUrl').replace(/\/+$/, '');
const buyUrl = () => `${banxaBaseUrl()}/${appConfig.get('Banxa.partnerRef')}/v2/buy`;
const orderUrl = (orderId) => `${banxaBaseUrl()}/${appConfig.get('Banxa.partnerRef')}/v2/orders/${orderId}`;
const webhookPath = () => '/v2/banxa/webhook';

const cryptoId = (order) => order.crypto?.id || order.crypto;
const cryptoBlockchain = (order) => order.crypto?.blockchain || order.blockchain;

class BanxaService {
  static isConfigured() {
    return requiredConfig().every(([, value]) => Boolean(value));
  }

  static validateConfigured() {
    const missing = requiredConfig()
      .filter(([, value]) => !value)
      .map(([path]) => path);
    if (missing.length) throw new ValidationError(`Banxa checkout missing config: ${missing.join(', ')}`);
  }

  static validateWebhookConfigured() {
    const missing = [
      ['Banxa.webhookApiKey', appConfig.get('Banxa.webhookApiKey')],
      ['Banxa.webhookSecret', appConfig.get('Banxa.webhookSecret')]
    ].filter(([, value]) => !value).map(([path]) => path);
    if (missing.length) throw new ValidationError(`Banxa webhook missing config: ${missing.join(', ')}`);
  }

  static verifyWebhook({ authorization, rawBody }) {
    this.validateWebhookConfigured();
    if (!authorization?.startsWith('Bearer ')) throw new ValidationError('Missing Banxa webhook signature');

    const [receivedKey, receivedSignature, nonce] = authorization.replace('Bearer ', '').split(':');
    if (!receivedKey || !receivedSignature || !nonce) throw new ValidationError('Invalid Banxa webhook signature');
    if (receivedKey !== appConfig.get('Banxa.webhookApiKey')) throw new ValidationError('Invalid Banxa webhook key');

    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const signedPayload = `POST\n${webhookPath()}\n${nonce}\n${payload}`;
    const expected = crypto
      .createHmac('sha256', appConfig.get('Banxa.webhookSecret'))
      .update(signedPayload)
      .digest('hex');

    const receivedBuffer = Buffer.from(receivedSignature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      receivedBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new ValidationError('Invalid Banxa webhook signature');
    }
  }

  static async validateDeployedWallet(address) {
    const provider = await starknetClient.createRpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });
    try {
      await provider.getClassAt(address, 'latest');
    } catch (error) {
      if (isContractNotDeployedError(error)) throw new ValidationError('Wallet must be deployed before Banxa checkout');
      throw new ValidationError('Unable to verify wallet deployment status');
    }
  }

  static checkoutRequest({ body, userAddress }) {
    let walletAddress;
    let authenticatedAddress;
    try {
      walletAddress = Address.toStandard(body.walletAddress, 'starknet');
      authenticatedAddress = Address.toStandard(userAddress, 'starknet');
    } catch (error) {
      throw new ValidationError('Invalid wallet address');
    }

    if (walletAddress !== authenticatedAddress) {
      throw new ValidationError('Wallet address must match authenticated user');
    }
    if (!body.returnUrl) throw new ValidationError('Missing returnUrl');
    if (!body.fiat) throw new ValidationError('Missing fiat');
    if (!body.crypto) throw new ValidationError('Missing crypto');
    if (!body.fiatAmount && !body.cryptoAmount) throw new ValidationError('Missing fiatAmount or cryptoAmount');

    return {
      blockchain: body.blockchain,
      crypto: body.crypto,
      cryptoAmount: body.cryptoAmount,
      externalCustomerId: authenticatedAddress,
      fiat: body.fiat,
      fiatAmount: body.fiatAmount,
      redirectUrl: body.returnUrl,
      walletAddress
    };
  }

  static async createCheckout({ body, userAddress }) {
    this.validateConfigured();
    const requestBody = this.checkoutRequest({ body, userAddress });
    await this.validateDeployedWallet(requestBody.walletAddress);

    const externalOrderId = new Types.ObjectId().toString();
    let response;
    try {
      response = await axios.post(buyUrl(), {
        ...requestBody,
        externalOrderId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.get('Banxa.apiKey')
        },
        responseType: 'json',
        timeout: Number(appConfig.get('Banxa.requestTimeoutMs'))
      });
    } catch (error) {
      throw new ValidationError(banxaErrorMessage(error));
    }

    const order = response.data;
    if (!order?.id || !order?.checkoutUrl) throw new ValidationError('Invalid Banxa checkout response');

    const persisted = await mongoose.model('BanxaOrder').create({
      banxaOrderId: order.id,
      blockchain: cryptoBlockchain(order) || requestBody.blockchain,
      checkoutUrl: order.checkoutUrl,
      crypto: cryptoId(order) || requestBody.crypto,
      cryptoAmount: order.cryptoAmount || requestBody.cryptoAmount,
      externalOrderId: order.externalOrderId || order.externalId || externalOrderId,
      fiat: order.fiat || requestBody.fiat,
      fiatAmount: order.fiatAmount || requestBody.fiatAmount,
      rawOrder: order,
      userAddress: requestBody.externalCustomerId,
      walletAddress: requestBody.walletAddress
    });

    return this.serializeOrder(persisted);
  }

  static async refreshOrder(order) {
    let response;
    try {
      response = await axios.get(orderUrl(order.banxaOrderId), {
        headers: { 'x-api-key': appConfig.get('Banxa.apiKey') },
        responseType: 'json',
        timeout: Number(appConfig.get('Banxa.requestTimeoutMs'))
      });
    } catch (error) {
      throw new ValidationError(banxaErrorMessage(error));
    }
    const banxaOrder = response.data;

    order.set({
      blockchain: cryptoBlockchain(banxaOrder) || order.blockchain,
      crypto: cryptoId(banxaOrder) || order.crypto,
      cryptoAmount: banxaOrder.cryptoAmount || order.cryptoAmount,
      fiat: banxaOrder.fiat || order.fiat,
      fiatAmount: banxaOrder.fiatAmount || order.fiatAmount,
      rawOrder: banxaOrder,
      status: banxaStatus(banxaOrder.status)
    });
    await order.save();
    return order;
  }

  static async orderForUser({ orderId, refresh = true, userAddress }) {
    this.validateConfigured();
    let order = await mongoose.model('BanxaOrder').findOne({
      banxaOrderId: orderId,
      userAddress: Address.toStandard(userAddress, 'starknet')
    });
    if (!order) throw new ValidationError('Banxa order not found');
    if (refresh) order = await this.refreshOrder(order);
    return this.serializeOrder(order);
  }

  static async updateOrderFromWebhook({ authorization, payload, rawBody }) {
    this.verifyWebhook({ authorization, rawBody });

    const orderId = orderIdFromWebhook(payload);
    if (!orderId) throw new ValidationError('Missing Banxa order id');

    const order = await mongoose.model('BanxaOrder').findOneAndUpdate(
      { banxaOrderId: orderId },
      {
        $push: { rawWebhookEvents: payload },
        $set: { status: orderStatusFromWebhook(payload) }
      },
      { new: true }
    );
    if (!order) throw new ValidationError('Banxa order not found');
    return this.serializeOrder(order);
  }

  static serializeOrder(order) {
    return {
      blockchain: order.blockchain || null,
      checkoutUrl: order.checkoutUrl,
      crypto: order.crypto,
      cryptoAmount: order.cryptoAmount || null,
      externalOrderId: order.externalOrderId,
      fiat: order.fiat,
      fiatAmount: order.fiatAmount || null,
      orderId: order.banxaOrderId,
      status: order.status,
      walletAddress: order.walletAddress
    };
  }
}

module.exports = BanxaService;
