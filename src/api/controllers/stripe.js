const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
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

const getProducts = async function (ctx) {
  const instance = stripeInstance();

  const [products, prices] = await Promise.all([
    instance.products.list({ active: true, limit: 100 }),
    instance.prices.list({ active: true, limit: 100 })
  ]);

  ctx.body = products.data.map((product) => {
    const productPrice = prices.data.find((p) => p.product === product.id);
    return {
      id: product.id,
      amount: productPrice?.unit_amount,
      currency: productPrice?.currency,
      name: product.name,
      description: product.description,
      metadata: product.metadata
    };
  });
};

const createCheckoutSession = async function (ctx) {
  const { params: { product }, state: { user: { sub: purchaser } }, request: { body } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  try {
    ctx.body = await StarterPackPurchaseService.createCheckoutSession({
      cancelUrl: body.cancelUrl,
      grantRequest: body.grantRequest,
      purchaser,
      product,
      stripe: stripeInstance(),
      successUrl: body.successUrl
    });
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

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
    .post('/v2/stripe/webhook', handleWebhook)
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
    .use(cors({ origin: allowedOrigin }))
    .use(corsOrJwt)
    .get('/v2/stripe', getProducts)
    .post('/v2/stripe/:product/checkout', bodyParser(), createCheckoutSession);
}

module.exports = router;
