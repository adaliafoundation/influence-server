const appConfig = require('config');
const fs = require('fs/promises');
const mongoose = require('mongoose');
const { hash, shortString, num } = require('starknet');
const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const starknetClient = require('@common/lib/starknet/client');
const Entity = require('@common/lib/Entity');
const { ValidationError } = require('@common/lib/errors');

const STARTER_PACK_COUNTS = {
  1: 2,
  2: 3,
  3: 5
};

const asNumberArray = (values = []) => values.map(Number);

const asFelt = (value) => {
  if (typeof value === 'number') return num.toHex(value);
  if (typeof value === 'bigint') return num.toHex(value);
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  return shortString.encodeShortString(value);
};

const readStarterPackPrivateKey = async () => {
  const keyFile = appConfig.get('Starknet.starterPackPrivateKeyFile');
  if (keyFile) return (await fs.readFile(keyFile, 'utf8')).trim();

  const privateKey = appConfig.get('Starknet.starterPackPrivateKey');
  if (!privateKey) throw new ValidationError('Missing starter pack private key');
  return privateKey;
};

class StarterPackPurchaseService {
  static externalRefForCheckoutSession(sessionId) {
    // Stripe Checkout Session IDs are too long for felt252, so store the raw ID and use this felt hash on-chain.
    return num.toHex(hash.starknetKeccak(sessionId));
  }

  static starterPackProductConfig(product) {
    const configs = appConfig.get('Stripe.starterPackProducts');
    const starterPackConfig = configs[product]
      || Object.values(configs).find((config) => config.stripeProductId === product);

    if (!starterPackConfig?.stripeProductId) throw new ValidationError('Invalid starter pack product');
    if (!STARTER_PACK_COUNTS[starterPackConfig.productId]) throw new ValidationError('Invalid starter pack product id');
    return starterPackConfig;
  }

  static validateGrantRequest({ productId, grantRequest }) {
    const count = STARTER_PACK_COUNTS[productId];
    if (!grantRequest?.recipient) throw new ValidationError('Missing recipient');
    if (!grantRequest?.station) throw new ValidationError('Missing station');
    if (!grantRequest?.restrictedUntil) throw new ValidationError('Missing restrictedUntil');

    const countFields = [
      'classes', 'impactful', 'genders', 'bodies', 'faces', 'hairs', 'hairColors', 'clothes', 'names'
    ];
    countFields.forEach((field) => {
      if ((grantRequest[field] || []).length !== count) {
        throw new ValidationError(`Invalid ${field} length`);
      }
    });

    if ((grantRequest.cosmetic || []).length !== count * 3) {
      throw new ValidationError('Invalid cosmetic length');
    }
  }

  static async createCheckoutSession({
    cancelUrl,
    grantRequest,
    purchaser,
    product,
    stripe,
    successUrl
  }) {
    if (!successUrl) throw new ValidationError('Missing successUrl');
    if (!cancelUrl) throw new ValidationError('Missing cancelUrl');

    const starterPackProduct = this.starterPackProductConfig(product);
    const stripeProduct = await stripe.products.retrieve(starterPackProduct.stripeProductId);
    if (!stripeProduct?.active) throw new ValidationError('Invalid product');

    const price = await stripe.prices.retrieve(stripeProduct.default_price);
    if (!price?.active) throw new ValidationError('Invalid price');

    const { productId } = starterPackProduct;
    this.validateGrantRequest({ productId, grantRequest });

    const purchase = await mongoose.model('StarterPackPurchase').create({
      grantRequest,
      productId,
      purchaser,
      status: 'checkout_created',
      stripePriceId: price.id,
      stripeProductId: stripeProduct.id
    });

    const session = await stripe.checkout.sessions.create({
      cancel_url: cancelUrl,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { purchaseId: purchase.id },
      mode: 'payment',
      payment_intent_data: {
        metadata: { purchaseId: purchase.id }
      },
      payment_method_types: appConfig.get('Stripe.checkoutPaymentMethodTypes'),
      success_url: successUrl
    });

    purchase.stripeCheckoutSessionId = session.id;
    purchase.externalRef = this.externalRefForCheckoutSession(session.id);
    await purchase.save();

    return {
      id: session.id,
      url: session.url
    };
  }

  static calldataFromPurchase(purchase) {
    const { grantRequest, productId } = purchase;
    const station = Entity.toEntity(grantRequest.station);
    const adminAddress = Address.toStandard(appConfig.get('Contracts.starknet.starterPackAdmin'), 'starknet');
    const now = Math.floor(Date.now() / 1000);

    return [
      Address.toStandard(grantRequest.recipient, 'starknet'),
      purchase.externalRef,
      productId,
      grantRequest.restrictedUntil,
      station.label,
      station.id,
      grantRequest.classes.length,
      ...asNumberArray(grantRequest.classes),
      grantRequest.impactful.length,
      ...asNumberArray(grantRequest.impactful),
      grantRequest.cosmetic.length,
      ...asNumberArray(grantRequest.cosmetic),
      grantRequest.genders.length,
      ...asNumberArray(grantRequest.genders),
      grantRequest.bodies.length,
      ...asNumberArray(grantRequest.bodies),
      grantRequest.faces.length,
      ...asNumberArray(grantRequest.faces),
      grantRequest.hairs.length,
      ...asNumberArray(grantRequest.hairs),
      grantRequest.hairColors.length,
      ...asNumberArray(grantRequest.hairColors),
      grantRequest.clothes.length,
      ...asNumberArray(grantRequest.clothes),
      grantRequest.names.length,
      ...grantRequest.names.map(asFelt),
      adminAddress,
      now,
      0,
      0
    ];
  }

  static async claimPurchaseForSubmission(purchase) {
    if (!purchase._id) return purchase;

    const claim = await mongoose.model('StarterPackPurchase').findOneAndUpdate(
      {
        _id: purchase._id,
        status: { $in: ['paid', 'grant_failed'] },
        txHash: { $in: [null, undefined] }
      },
      { $set: { grantError: null, status: 'submitting' } },
      { new: true }
    );

    if (claim) return claim;

    const current = await mongoose.model('StarterPackPurchase').findById(purchase._id);
    if (current?.status === 'submitted' || current?.status === 'granted') return current;
    return null;
  }

  static async submitGrant(purchase) {
    if (purchase.status === 'submitted' || purchase.status === 'granted') return purchase.txHash;
    if (!purchase.externalRef) throw new ValidationError('Missing externalRef');
    const grantPurchase = await this.claimPurchaseForSubmission(purchase);
    if (!grantPurchase) return null;

    const provider = await starknetClient.createRpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });
    const account = starknetClient.createAccount({
      provider,
      address: appConfig.get('Contracts.starknet.starterPackAdmin'),
      signer: await readStarterPackPrivateKey()
    });

    try {
      const response = await account.execute({
        calldata: this.calldataFromPurchase(grantPurchase),
        contractAddress: appConfig.get('Contracts.starknet.grantOffchainStarterPack'),
        entrypoint: 'run'
      });

      grantPurchase.txHash = response.transaction_hash;
      grantPurchase.status = 'submitted';
      grantPurchase.grantError = null;
      await grantPurchase.save();
      return grantPurchase.txHash;
    } catch (error) {
      logger.error(
        `STARTER_PACK_GRANT_FAILED purchase=${grantPurchase.id} session=${grantPurchase.stripeCheckoutSessionId} `
        + `product=${grantPurchase.productId} reason=${error.message || error}`
      );
      grantPurchase.status = 'grant_failed';
      grantPurchase.grantError = error.message || String(error);
      await grantPurchase.save();
      throw new ValidationError('Failed to submit starter pack grant');
    }
  }

  static async handleCheckoutSessionCompleted({ event, stripe }) {
    const session = event.data.object;
    const purchaseId = session.metadata?.purchaseId;
    if (!purchaseId) throw new ValidationError('Missing purchase metadata');

    const purchase = await mongoose.model('StarterPackPurchase').findById(purchaseId);
    if (!purchase) throw new ValidationError('Purchase not found');
    if (purchase.stripeCheckoutSessionId !== session.id) throw new ValidationError('Checkout session mismatch');

    if (!purchase.stripeEventIds.includes(event.id)) purchase.stripeEventIds.push(event.id);
    purchase.externalRef = this.externalRefForCheckoutSession(session.id);

    if (session.payment_status !== 'paid') {
      await purchase.save();
      return null;
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const stripeProductId = lineItems.data[0]?.price?.product;
    if (stripeProductId !== purchase.stripeProductId) throw new ValidationError('Starter pack product mismatch');

    if (purchase.status === 'checkout_created') purchase.status = 'paid';
    await purchase.save();

    return this.submitGrant(purchase);
  }
}

module.exports = StarterPackPurchaseService;
