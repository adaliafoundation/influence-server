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

const getProducts = async function (ctx) {
  ctx.body = {
    products: await StarterPackPurchaseService.listProducts({ stripe: stripeInstance() })
  };
};

const createCheckoutSession = async function (ctx) {
  const { state: { user: { sub: purchaser } }, request: { body } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  try {
    const result = await StarterPackPurchaseService.createCheckoutSession({
      cancelUrl: body.cancelUrl,
      product: body.packType,
      productId: body.productId,
      purchaser,
      recipient: body.recipient,
      stripe: stripeInstance(),
      successUrl: body.successUrl
    });

    ctx.body = {
      checkoutSessionId: result.id,
      purchase: result.purchase,
      url: result.url
    };
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getPendingPurchase = async function (ctx) {
  const { state: { user: { sub: purchaser } } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  ctx.body = {
    purchase: await StarterPackPurchaseService.pendingPurchaseForPurchaser({ purchaser })
  };
};

const getPurchaseByCheckoutSession = async function (ctx) {
  const { params: { checkoutSessionId }, state: { user: { sub: purchaser } } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  ctx.body = {
    purchase: await StarterPackPurchaseService.purchaseForCheckoutSession({
      checkoutSessionId,
      purchaser
    })
  };
};

const completeCustomization = async function (ctx) {
  const { state: { user: { sub: purchaser } }, request: { body } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  try {
    ctx.body = {
      purchase: await StarterPackPurchaseService.completeGrantRequest({
        grantRequest: body.grantRequest,
        purchaseId: body.purchaseId,
        purchaser
      })
    };
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const router = new KoaRouter();

if (isProvisionerEnabled()) {
  router
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
    .use(cors({ origin: allowedOrigin }))
    .use(corsOrJwt)
    .get('/v2/starter-packs/products', getProducts)
    .get('/v2/starter-packs/pending', getPendingPurchase)
    .get('/v2/starter-packs/checkout/:checkoutSessionId', getPurchaseByCheckoutSession)
    .post('/v2/starter-packs/checkout', bodyParser(), createCheckoutSession)
    .post('/v2/starter-packs/customization', bodyParser(), completeCustomization);
}

module.exports = router;
