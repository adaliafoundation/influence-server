const appConfig = require('config');
const KoaRouter = require('@koa/router');
const { StarterPackPurchaseService } = require('@common/services');
const Stripe = require('stripe');

const isProvisionerEnabled = () => Number(appConfig.get('StarterPack.provisionerEnabled')) === 1;
const stripeInstance = () => Stripe(appConfig.get('Stripe.secretKey'));

const validateProvisionerConfig = () => {
  const missingPaths = [
    'Contracts.starknet.grantOffchainStarterPack',
    'Contracts.starknet.starterPackAdmin',
    'Starknet.rpcProvider',
    'Stripe.secretKey',
    'Stripe.webhookSecret',
    'Stripe.starterPackProducts.explorer.stripeProductId',
    'Stripe.starterPackProducts.strategist.stripeProductId',
    'Stripe.starterPackProducts.industrialist.stripeProductId'
  ].filter((path) => !appConfig.get(path));

  if (!appConfig.get('Starknet.starterPackPrivateKey') && !appConfig.get('Starknet.starterPackPrivateKeyFile')) {
    missingPaths.push('Starknet.starterPackPrivateKey or Starknet.starterPackPrivateKeyFile');
  }

  if (missingPaths.length > 0) {
    throw new Error(`Starter pack provisioner enabled with missing config: ${missingPaths.join(', ')}`);
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
    await StarterPackPurchaseService.handleCheckoutSessionCompleted({
      event,
      stripe: stripeInstance()
    });
  }

  ctx.status = 200;
  ctx.body = { received: true };
};

// Setup routes
const router = new KoaRouter();

if (isProvisionerEnabled()) {
  validateProvisionerConfig();

  router
    .post('/v2/stripe/webhook', handleWebhook);
}

module.exports = router;
