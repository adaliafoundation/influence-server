const appConfig = require('config');
const KoaRouter = require('@koa/router');
const {
  isCrewmateProvisionerEnabled,
  isStarterPackProvisionerEnabled
} = require('@common/lib/officialFeatures');
const { CrewmatePurchaseService, StarterPackPurchaseService } = require('@common/services');
const Stripe = require('stripe');

const stripeInstance = () => Stripe(appConfig.get('Stripe.secretKey'));
const provisionerEnabled = () => isStarterPackProvisionerEnabled() || isCrewmateProvisionerEnabled();

const validateProvisionerConfig = () => {
  const missingPaths = [
    'Contracts.starknet.dispatcher',
    'Contracts.starknet.starterPackAdmin',
    'Starknet.rpcProvider',
    'Stripe.secretKey',
    'Stripe.webhookSecret'
  ].filter((path) => !appConfig.get(path));

  if (isStarterPackProvisionerEnabled()) {
    missingPaths.push(...[
      'Stripe.starterPackProducts.explorer.stripeProductId',
      'Stripe.starterPackProducts.strategist.stripeProductId',
      'Stripe.starterPackProducts.industrialist.stripeProductId'
    ].filter((path) => !appConfig.get(path)));
  }
  if (isCrewmateProvisionerEnabled() && !appConfig.get('Stripe.crewmateProduct.stripeProductId')) {
    missingPaths.push('Stripe.crewmateProduct.stripeProductId');
  }

  if (!appConfig.get('Starknet.starterPackPrivateKey') && !appConfig.get('Starknet.starterPackPrivateKeyFile')) {
    missingPaths.push('Starknet.starterPackPrivateKey or Starknet.starterPackPrivateKeyFile');
  }

  if (missingPaths.length > 0) {
    throw new Error(`Offchain provisioner enabled with missing config: ${missingPaths.join(', ')}`);
  }
};

const readRawBody = async (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const handleWebhook = async function (ctx) {
  const signature = ctx.get('stripe-signature');
  if (!signature) ctx.throw(400, 'Missing Stripe signature');

  const rawBody = await readRawBody(ctx.req);
  let event;

  try {
    event = stripeInstance().webhooks.constructEvent(
      rawBody,
      signature,
      appConfig.get('Stripe.webhookSecret')
    );
  } catch (error) {
    ctx.throw(400, error.message);
  }

  if (event.type === 'checkout.session.completed') {
    const purchaseType = event.data.object.metadata?.purchaseType;
    let service;
    if (purchaseType === 'crewmate' && isCrewmateProvisionerEnabled()) service = CrewmatePurchaseService;
    if (purchaseType === 'starter_pack' && isStarterPackProvisionerEnabled()) service = StarterPackPurchaseService;

    if (service) {
      await service.handleCheckoutSessionCompleted({
        event,
        stripe: stripeInstance()
      });
    }
  }

  ctx.status = 200;
  ctx.body = { received: true };
};

// Setup routes
const router = new KoaRouter();

if (provisionerEnabled()) {
  validateProvisionerConfig();

  router
    .post('/v2/stripe/webhook', handleWebhook);
}

module.exports = router;
