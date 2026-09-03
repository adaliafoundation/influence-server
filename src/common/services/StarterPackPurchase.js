const appConfig = require('config');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const starknetClient = require('@common/lib/starknet/client');
const Entity = require('@common/lib/Entity');
const { ValidationError } = require('@common/lib/errors');
const OffchainPurchaseService = require('./OffchainPurchase');

const STARTER_PACK_COUNTS = {
  1: 2,
  2: 3,
  3: 5
};

const STARTER_PACK_DEFINITIONS = {
  explorer: {
    buildings: [
      { id: 1, name: 'Warehouse' },
      { id: 2, name: 'Extractor' }
    ],
    coreSampleAllowance: 5,
    foodReloadAllowance: 1,
    lotAllowance: 2,
    productId: 1,
    sortOrder: 1
  },
  strategist: {
    buildings: [
      { id: 1, name: 'Warehouse' },
      { id: 2, name: 'Extractor' },
      { id: 3, name: 'Refinery' }
    ],
    coreSampleAllowance: 8,
    foodReloadAllowance: 1,
    lotAllowance: 3,
    productId: 2,
    sortOrder: 2
  },
  industrialist: {
    buildings: [
      { id: 1, name: 'Warehouse' },
      { id: 2, name: 'Extractor' },
      { id: 3, name: 'Refinery' },
      { id: 4, name: 'Bioreactor' },
      { id: 5, name: 'Factory' }
    ],
    coreSampleAllowance: 12,
    foodReloadAllowance: 1,
    lotAllowance: 5,
    productId: 3,
    sortOrder: 3
  }
};

const PENDING_PURCHASE_STATUSES = [
  'checkout_created',
  'paid_pending_customization',
  'grant_submitting',
  'grant_submitted',
  'grant_failed'
];

const GRANT_SYSTEM_NAME = 'GrantOffchainStarterPack';
const asNumberArray = (values = []) => values.map(Number);

class StarterPackPurchaseService {
  static externalRefForCheckoutSession(sessionId) {
    return OffchainPurchaseService.externalRefForCheckoutSession(sessionId);
  }

  static packTypeForProductId(productId) {
    return Object.entries(STARTER_PACK_DEFINITIONS)
      .find(([, definition]) => definition.productId === productId)?.[0] || null;
  }

  static starterPackProductConfig(product) {
    const configs = appConfig.get('Stripe.starterPackProducts');
    const starterPackConfig = configs[product]
      || Object.values(configs).find((config) => config.stripeProductId === product);

    if (!starterPackConfig?.stripeProductId) throw new ValidationError('Invalid starter pack product');
    if (!STARTER_PACK_COUNTS[starterPackConfig.productId]) throw new ValidationError('Invalid starter pack product id');
    return starterPackConfig;
  }

  static starterPackProductConfigForCheckout({ packType, productId }) {
    if (packType && productId) {
      const config = this.starterPackProductConfig(packType);
      if (config.productId !== Number(productId)) throw new ValidationError('Starter pack product mismatch');
      return config;
    }

    if (packType) return this.starterPackProductConfig(packType);

    const resolvedPackType = this.packTypeForProductId(Number(productId));
    if (!resolvedPackType) throw new ValidationError('Invalid starter pack product');
    return this.starterPackProductConfig(resolvedPackType);
  }

  static async listProducts({ stripe }) {
    const products = await Promise.all(Object.entries(STARTER_PACK_DEFINITIONS).map(async ([packType, definition]) => {
      const config = this.starterPackProductConfig(packType);
      const { product: stripeProduct, price, ...stripeDetails } = await OffchainPurchaseService.stripeProduct({
        stripe,
        stripeProductId: config.stripeProductId
      });

      return {
        ...stripeDetails,
        buildings: definition.buildings,
        coreSampleAllowance: definition.coreSampleAllowance,
        foodReloadAllowance: definition.foodReloadAllowance,
        lotAllowance: definition.lotAllowance,
        packType,
        productId: definition.productId,
        requiredCrewmates: STARTER_PACK_COUNTS[definition.productId],
        sortOrder: definition.sortOrder,
        stripePriceId: price?.id ?? null,
        stripeProductId: stripeProduct.id
      };
    }));

    return products.sort((a, b) => a.sortOrder - b.sortOrder);
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
    purchaser,
    product,
    productId: requestedProductId,
    recipient,
    returnUrl,
    stripe
  }) {
    if (!returnUrl) throw new ValidationError('Missing returnUrl');

    const purchaserAddress = Address.toStandard(purchaser);
    const recipientAddress = Address.toStandard(recipient || purchaser);
    if (recipientAddress !== purchaserAddress) throw new ValidationError('Recipient must match purchaser');

    const starterPackProduct = this.starterPackProductConfigForCheckout({
      packType: product,
      productId: requestedProductId
    });
    const stripeProduct = await stripe.products.retrieve(starterPackProduct.stripeProductId);
    if (!stripeProduct?.active) throw new ValidationError('Invalid product');

    const price = await stripe.prices.retrieve(stripeProduct.default_price);
    if (!price?.active) throw new ValidationError('Invalid price');

    const { productId } = starterPackProduct;

    const purchase = await mongoose.model('StarterPackPurchase').create({
      ...OffchainPurchaseService.environment(),
      productId,
      purchaser: purchaserAddress,
      recipient: recipientAddress,
      status: 'checkout_created',
      stripePriceId: price.id,
      stripeProductId: stripeProduct.id
    });

    const session = await stripe.checkout.sessions.create({
      client_reference_id: purchase.id,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        purchaseType: 'starter_pack',
        purchaseId: purchase.id,
        productId,
        recipient: recipientAddress
      },
      mode: 'payment',
      payment_intent_data: {
        metadata: {
          purchaseId: purchase.id,
          productId,
          recipient: recipientAddress
        }
      },
      payment_method_types: appConfig.get('Stripe.checkoutPaymentMethodTypes'),
      redirect_on_completion: 'if_required',
      return_url: returnUrl,
      ui_mode: 'embedded'
    });

    purchase.stripeCheckoutSessionId = session.id;
    purchase.externalRef = this.externalRefForCheckoutSession(session.id);
    await purchase.save();

    return {
      clientSecret: session.client_secret,
      id: session.id,
      purchase: this.serializePurchase(purchase),
      purchaseId: purchase.id
    };
  }

  static serializePurchase(purchase) {
    if (!purchase) return null;
    const doc = purchase.toObject ? purchase.toObject() : purchase;
    const packType = this.packTypeForProductId(doc.productId);
    const refundClosesAt = OffchainPurchaseService.refundWindowClosesAt(doc);
    return {
      canCustomize: doc.status === 'paid_pending_customization' || doc.status === 'grant_failed',
      chainId: doc.chainId,
      chainSlug: doc.chainSlug,
      id: doc._id?.toString() || doc.id,
      externalRef: doc.externalRef,
      grantSubmittedAt: doc.grantSubmittedAt,
      grantedAt: doc.grantedAt,
      grantedCrew: doc.grantedCrew,
      grantError: doc.grantError,
      hasGrantRequest: Boolean(doc.grantRequest),
      paidAt: doc.paidAt,
      packType,
      productId: doc.productId,
      purchaser: doc.purchaser,
      recipient: doc.recipient,
      requiredCrewmates: STARTER_PACK_COUNTS[doc.productId],
      refundWindowClosesAt: refundClosesAt,
      refundWindowOpen: Boolean(refundClosesAt && new Date(refundClosesAt) > new Date()),
      sponsorshipEndsAt: OffchainPurchaseService.addRestrictionWindow(doc.grantedAt),
      status: doc.status,
      stripeCheckoutSessionId: doc.stripeCheckoutSessionId,
      txHash: doc.txHash
    };
  }

  static async pendingPurchaseForPurchaser({ purchaser }) {
    const purchaserAddress = Address.toStandard(purchaser);
    const purchase = await mongoose.model('StarterPackPurchase').findOne({
      purchaser: purchaserAddress,
      status: { $in: PENDING_PURCHASE_STATUSES }
    }).sort({ createdAt: -1 });

    return this.serializePurchase(purchase);
  }

  static async purchaseForCheckoutSession({
    checkoutSessionId,
    purchaser
  }) {
    const purchaserAddress = Address.toStandard(purchaser);
    const purchase = await mongoose.model('StarterPackPurchase').findOne({
      purchaser: purchaserAddress,
      stripeCheckoutSessionId: checkoutSessionId
    });

    return this.serializePurchase(purchase);
  }

  static async resumeCheckoutSession({
    checkoutSessionId,
    purchaser,
    stripe
  }) {
    const purchase = await this.purchaseForCheckoutSession({ checkoutSessionId, purchaser });
    if (!purchase || purchase.status !== 'checkout_created') return { clientSecret: null, purchase };

    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    return {
      clientSecret: session.client_secret,
      purchase
    };
  }

  static async completeGrantRequest({
    grantRequest,
    purchaseId,
    purchaser
  }) {
    if (!purchaseId) throw new ValidationError('Missing purchaseId');

    const purchaserAddress = Address.toStandard(purchaser);
    const purchase = await mongoose.model('StarterPackPurchase').findById(purchaseId);
    if (!purchase) throw new ValidationError('Purchase not found');
    if (purchase.purchaser !== purchaserAddress) throw new ValidationError('Purchase does not belong to purchaser');

    if (purchase.status === 'checkout_created') throw new ValidationError('Payment not completed');
    if (purchase.status === 'grant_submitted' || purchase.status === 'grant_confirmed') {
      return this.serializePurchase(purchase);
    }
    if (!['paid_pending_customization', 'grant_failed'].includes(purchase.status)) {
      throw new ValidationError('Purchase is not ready for grant');
    }

    const request = {
      ...grantRequest,
      recipient: purchase.recipient,
      restrictedUntil: OffchainPurchaseService.restrictedUntil()
    };
    this.validateGrantRequest({ productId: purchase.productId, grantRequest: request });

    purchase.grantRequest = request;
    await purchase.save();

    await this.submitGrant(purchase);
    const updatedPurchase = await mongoose.model('StarterPackPurchase').findById(purchase._id);
    return this.serializePurchase(updatedPurchase);
  }

  static calldataFromPurchase(purchase) {
    const { grantRequest, productId } = purchase;
    const station = Entity.toEntity(grantRequest.station);

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
      ...grantRequest.names.map(OffchainPurchaseService.asFelt)
    ];
  }

  static callFromPurchase(purchase) {
    const calldata = this.calldataFromPurchase(purchase);

    return {
      calldata: [shortString.encodeShortString(GRANT_SYSTEM_NAME), calldata.length, ...calldata],
      contractAddress: appConfig.get('Contracts.starknet.dispatcher'),
      entrypoint: 'run_system'
    };
  }

  static async claimPurchaseForSubmission(purchase) {
    if (!purchase._id) return purchase;

    const claim = await mongoose.model('StarterPackPurchase').findOneAndUpdate(
      {
        _id: purchase._id,
        status: { $in: ['paid_pending_customization', 'grant_failed'] },
        txHash: { $in: [null, undefined] }
      },
      { $set: { grantError: null, status: 'grant_submitting' } },
      { new: true }
    );

    if (claim) return claim;

    const current = await mongoose.model('StarterPackPurchase').findById(purchase._id);
    if (current?.status === 'grant_submitted' || current?.status === 'grant_confirmed') return current;
    return null;
  }

  static async submitGrant(purchase) {
    if (purchase.status === 'grant_submitted' || purchase.status === 'grant_confirmed') return purchase.txHash;
    if (!purchase.externalRef) throw new ValidationError('Missing externalRef');
    if (!purchase.grantRequest) throw new ValidationError('Missing starter pack customization');
    const grantPurchase = await this.claimPurchaseForSubmission(purchase);
    if (!grantPurchase) return null;

    try {
      const provider = await starknetClient.createRpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });
      const account = starknetClient.createAccount({
        provider,
        address: appConfig.get('Contracts.starknet.starterPackAdmin'),
        signer: await OffchainPurchaseService.readPrivateKey()
      });
      const response = await account.execute(this.callFromPurchase(grantPurchase));

      grantPurchase.txHash = response.transaction_hash;
      grantPurchase.status = 'grant_submitted';
      grantPurchase.grantError = null;
      grantPurchase.grantSubmittedAt = new Date();
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

    if (purchase.status === 'checkout_created') {
      purchase.status = 'paid_pending_customization';
      purchase.paidAt = purchase.paidAt || new Date();
      Object.assign(purchase, OffchainPurchaseService.environment());
    }
    await purchase.save();

    return this.serializePurchase(purchase);
  }
}

module.exports = StarterPackPurchaseService;
