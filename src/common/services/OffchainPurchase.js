const appConfig = require('config');
const fs = require('fs/promises');
const { hash, num, shortString } = require('starknet');
const { ValidationError } = require('@common/lib/errors');

const RESTRICTION_WINDOW_DAYS = 14;
const RESTRICTION_WINDOW_SECONDS = RESTRICTION_WINDOW_DAYS * 24 * 60 * 60;

class OffchainPurchaseService {
  static externalRefForCheckoutSession(sessionId) {
    return num.toHex(hash.starknetKeccak(sessionId));
  }

  static asFelt(value) {
    if (typeof value === 'number' || typeof value === 'bigint') return num.toHex(value);
    if (typeof value === 'string' && value.startsWith('0x')) return value;
    return shortString.encodeShortString(value);
  }

  static environment() {
    return {
      chainId: appConfig.get('Starknet.chainId')?.toString(),
      chainSlug: appConfig.has('Starknet.chainSlug') ? appConfig.get('Starknet.chainSlug') : null
    };
  }

  static restrictedUntil() {
    return Math.floor(Date.now() / 1000) + RESTRICTION_WINDOW_SECONDS;
  }

  static addRestrictionWindow(date) {
    if (!date) return null;
    return new Date(new Date(date).getTime() + RESTRICTION_WINDOW_SECONDS * 1000);
  }

  static refundWindowClosesAt(purchase) {
    if (purchase.grantSubmittedAt) return purchase.grantSubmittedAt;
    return this.addRestrictionWindow(purchase.paidAt);
  }

  static async readPrivateKey() {
    const keyFile = appConfig.get('Starknet.starterPackPrivateKeyFile');
    if (keyFile) return (await fs.readFile(keyFile, 'utf8')).trim();

    const privateKey = appConfig.get('Starknet.starterPackPrivateKey');
    if (!privateKey) throw new ValidationError('Missing offchain provisioner private key');
    return privateKey;
  }

  static async stripeProduct({ stripe, stripeProductId }) {
    const product = await stripe.products.retrieve(stripeProductId);
    const price = product.default_price ? await stripe.prices.retrieve(product.default_price) : null;

    return {
      amount: price?.unit_amount ?? null,
      currency: price?.currency ?? null,
      description: product.description || null,
      enabled: Boolean(product.active && price?.active),
      features: (product.marketing_features || []).map(({ name }) => name).filter(Boolean),
      name: product.name,
      price,
      product
    };
  }
}

module.exports = OffchainPurchaseService;
