const appConfig = require('config');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const starknetClient = require('@common/lib/starknet/client');
const Entity = require('@common/lib/Entity');
const { ValidationError } = require('@common/lib/errors');
const OffchainPurchaseService = require('./OffchainPurchase');

const GRANT_SYSTEM_NAME = 'GrantOffchainCrewmate';
const PENDING_PURCHASE_STATUSES = [
  'checkout_created',
  'paid_pending_customization',
  'grant_submitting',
  'grant_submitted',
  'grant_failed'
];

const numericFields = ['class', 'gender', 'body', 'face', 'hair', 'hairColor', 'clothes'];

const validatedEntity = (value, message) => {
  try {
    return Entity.toEntity(value || {});
  } catch (error) {
    throw new ValidationError(message);
  }
};

class CrewmatePurchaseService {
  static configuredProductId() {
    const productId = appConfig.get('Stripe.crewmateProduct.stripeProductId');
    if (!productId) throw new ValidationError('Crewmate product is not configured');
    return productId;
  }

  static async listProducts({ stripe }) {
    const stripeProductId = this.configuredProductId();
    const { product, price, ...details } = await OffchainPurchaseService.stripeProduct({
      stripe,
      stripeProductId
    });

    return [{
      ...details,
      productId: product.id,
      requiredCrewmates: 1,
      stripePriceId: price?.id ?? null,
      stripeProductId: product.id
    }];
  }

  static validateGrantRequest(grantRequest) {
    if (!grantRequest?.recipient) throw new ValidationError('Missing recipient');
    if (!grantRequest?.restrictedUntil) throw new ValidationError('Missing restrictedUntil');

    const station = validatedEntity(grantRequest.station, 'Invalid station');
    if (!station.isValid()) throw new ValidationError('Invalid station');

    const callerCrew = validatedEntity(grantRequest.callerCrew, 'Invalid callerCrew');
    if (!callerCrew.isCrew()) throw new ValidationError('Invalid callerCrew');

    if ((grantRequest.impactful || []).length !== 1) throw new ValidationError('Invalid impactful length');
    if ((grantRequest.cosmetic || []).length !== 3) throw new ValidationError('Invalid cosmetic length');
    if (!grantRequest.name) throw new ValidationError('Invalid name');

    numericFields.forEach((field) => {
      if (!Number.isSafeInteger(Number(grantRequest[field])) || Number(grantRequest[field]) < 0) {
        throw new ValidationError(`Invalid ${field}`);
      }
    });

    [...grantRequest.impactful, ...grantRequest.cosmetic].forEach((value) => {
      if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) {
        throw new ValidationError('Invalid trait value');
      }
    });

    try {
      shortString.encodeShortString(grantRequest.name);
    } catch (error) {
      throw new ValidationError('Invalid name');
    }
  }

  static async createCheckoutSession({ purchaser, productId, recipient, returnUrl, stripe }) {
    if (!returnUrl) throw new ValidationError('Missing returnUrl');

    const purchaserAddress = Address.toStandard(purchaser);
    const recipientAddress = Address.toStandard(recipient || purchaser);
    if (recipientAddress !== purchaserAddress) throw new ValidationError('Recipient must match purchaser');

    const configuredProductId = this.configuredProductId();
    if (productId && productId !== configuredProductId) throw new ValidationError('Invalid crewmate product');

    const { product, price } = await OffchainPurchaseService.stripeProduct({
      stripe,
      stripeProductId: configuredProductId
    });
    if (!product.active) throw new ValidationError('Invalid product');
    if (!price?.active) throw new ValidationError('Invalid price');

    const purchase = await mongoose.model('CrewmatePurchase').create({
      ...OffchainPurchaseService.environment(),
      purchaser: purchaserAddress,
      recipient: recipientAddress,
      status: 'checkout_created',
      stripePriceId: price.id,
      stripeProductId: product.id
    });

    const metadata = {
      purchaseId: purchase.id,
      purchaseType: 'crewmate',
      recipient: recipientAddress
    };
    const session = await stripe.checkout.sessions.create({
      client_reference_id: purchase.id,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      mode: 'payment',
      payment_intent_data: { metadata },
      payment_method_types: appConfig.get('Stripe.checkoutPaymentMethodTypes'),
      redirect_on_completion: 'if_required',
      return_url: returnUrl,
      ui_mode: 'embedded'
    });

    purchase.stripeCheckoutSessionId = session.id;
    purchase.externalRef = OffchainPurchaseService.externalRefForCheckoutSession(session.id);
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
    const refundClosesAt = OffchainPurchaseService.refundWindowClosesAt(doc);
    return {
      canCustomize: ['paid_pending_customization', 'grant_failed'].includes(doc.status),
      chainId: doc.chainId,
      chainSlug: doc.chainSlug,
      externalRef: doc.externalRef,
      grantError: doc.grantError,
      grantedAt: doc.grantedAt,
      grantedCrew: doc.grantedCrew,
      grantedCrewmate: doc.grantedCrewmate,
      grantSubmittedAt: doc.grantSubmittedAt,
      hasGrantRequest: Boolean(doc.grantRequest),
      id: doc._id?.toString() || doc.id,
      paidAt: doc.paidAt,
      productId: doc.stripeProductId,
      purchaser: doc.purchaser,
      recipient: doc.recipient,
      refundWindowClosesAt: refundClosesAt,
      refundWindowOpen: Boolean(refundClosesAt && new Date(refundClosesAt) > new Date()),
      requiredCrewmates: 1,
      status: doc.status,
      stripeCheckoutSessionId: doc.stripeCheckoutSessionId,
      txHash: doc.txHash
    };
  }

  static async pendingPurchaseForPurchaser({ purchaser }) {
    const purchase = await mongoose.model('CrewmatePurchase').findOne({
      purchaser: Address.toStandard(purchaser),
      status: { $in: PENDING_PURCHASE_STATUSES }
    }).sort({ createdAt: -1 });
    return this.serializePurchase(purchase);
  }

  static async purchaseForCheckoutSession({ checkoutSessionId, purchaser }) {
    const purchase = await mongoose.model('CrewmatePurchase').findOne({
      purchaser: Address.toStandard(purchaser),
      stripeCheckoutSessionId: checkoutSessionId
    });
    return this.serializePurchase(purchase);
  }

  static async resumeCheckoutSession({ checkoutSessionId, purchaser, stripe }) {
    const purchase = await this.purchaseForCheckoutSession({ checkoutSessionId, purchaser });
    if (!purchase || purchase.status !== 'checkout_created') return { clientSecret: null, purchase };

    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    return { clientSecret: session.client_secret, purchase };
  }

  static async validateCrewOwnership({ callerCrew, recipient }) {
    const crew = Entity.toEntity(callerCrew);
    const owner = Address.toStandard(recipient, 'starknet');
    const ownedCrew = await mongoose.model('NftComponent').exists({
      'entity.uuid': crew.uuid,
      'owners.starknet': owner
    });
    if (!ownedCrew) throw new ValidationError('Recipient does not own callerCrew');
  }

  static async completeGrantRequest({ grantRequest, purchaseId, purchaser }) {
    if (!purchaseId) throw new ValidationError('Missing purchaseId');

    const purchaserAddress = Address.toStandard(purchaser);
    const purchase = await mongoose.model('CrewmatePurchase').findById(purchaseId);
    if (!purchase) throw new ValidationError('Purchase not found');
    if (purchase.purchaser !== purchaserAddress) throw new ValidationError('Purchase does not belong to purchaser');
    if (purchase.status === 'checkout_created') throw new ValidationError('Payment not completed');
    if (['grant_submitted', 'grant_confirmed'].includes(purchase.status)) return this.serializePurchase(purchase);
    if (!['paid_pending_customization', 'grant_failed'].includes(purchase.status)) {
      throw new ValidationError('Purchase is not ready for grant');
    }

    const request = {
      ...grantRequest,
      recipient: purchase.recipient,
      restrictedUntil: OffchainPurchaseService.restrictedUntil()
    };
    this.validateGrantRequest(request);
    await this.validateCrewOwnership({ callerCrew: request.callerCrew, recipient: purchase.recipient });

    purchase.grantRequest = request;
    await purchase.save();
    await this.submitGrant(purchase);

    return this.serializePurchase(await mongoose.model('CrewmatePurchase').findById(purchase._id));
  }

  static calldataFromPurchase(purchase) {
    const request = purchase.grantRequest;
    const station = Entity.toEntity(request.station);
    const callerCrew = Entity.toEntity(request.callerCrew);

    return [
      Address.toStandard(request.recipient, 'starknet'),
      purchase.externalRef,
      request.restrictedUntil,
      station.label,
      station.id,
      callerCrew.label,
      callerCrew.id,
      Number(request.class),
      request.impactful.length,
      ...request.impactful.map(Number),
      request.cosmetic.length,
      ...request.cosmetic.map(Number),
      Number(request.gender),
      Number(request.body),
      Number(request.face),
      Number(request.hair),
      Number(request.hairColor),
      Number(request.clothes),
      OffchainPurchaseService.asFelt(request.name)
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
    const claim = await mongoose.model('CrewmatePurchase').findOneAndUpdate(
      {
        _id: purchase._id,
        status: { $in: ['paid_pending_customization', 'grant_failed'] },
        txHash: { $in: [null, undefined] }
      },
      { $set: { grantError: null, status: 'grant_submitting' } },
      { new: true }
    );
    if (claim) return claim;

    const current = await mongoose.model('CrewmatePurchase').findById(purchase._id);
    if (['grant_submitted', 'grant_confirmed'].includes(current?.status)) return current;
    return null;
  }

  static async submitGrant(purchase) {
    if (['grant_submitted', 'grant_confirmed'].includes(purchase.status)) return purchase.txHash;
    if (!purchase.externalRef) throw new ValidationError('Missing externalRef');
    if (!purchase.grantRequest) throw new ValidationError('Missing crewmate customization');

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
        `CREWMATE_GRANT_FAILED purchase=${grantPurchase.id} session=${grantPurchase.stripeCheckoutSessionId} `
        + `reason=${error.message || error}`
      );
      grantPurchase.status = 'grant_failed';
      grantPurchase.grantError = error.message || String(error);
      await grantPurchase.save();
      throw new ValidationError('Failed to submit crewmate grant');
    }
  }

  static async handleCheckoutSessionCompleted({ event, stripe }) {
    const session = event.data.object;
    const purchase = await mongoose.model('CrewmatePurchase').findById(session.metadata?.purchaseId);
    if (!purchase) throw new ValidationError('Purchase not found');
    if (purchase.stripeCheckoutSessionId !== session.id) throw new ValidationError('Checkout session mismatch');

    if (!purchase.stripeEventIds.includes(event.id)) purchase.stripeEventIds.push(event.id);
    purchase.externalRef = OffchainPurchaseService.externalRefForCheckoutSession(session.id);
    if (session.payment_status !== 'paid') {
      await purchase.save();
      return null;
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    if (lineItems.data[0]?.price?.product !== purchase.stripeProductId) {
      throw new ValidationError('Crewmate product mismatch');
    }

    if (purchase.status === 'checkout_created') {
      purchase.status = 'paid_pending_customization';
      purchase.paidAt = purchase.paidAt || new Date();
      Object.assign(purchase, OffchainPurchaseService.environment());
    }
    await purchase.save();
    return this.serializePurchase(purchase);
  }
}

module.exports = CrewmatePurchaseService;
