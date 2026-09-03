const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const Stripe = require('stripe');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { isCrewmateProvisionerEnabled } = require('@common/lib/officialFeatures');
const { CrewmatePurchaseService } = require('@common/services');

const stripeInstance = () => Stripe(appConfig.get('Stripe.secretKey'));

const getProducts = async function (ctx) {
  ctx.body = { products: await CrewmatePurchaseService.listProducts({ stripe: stripeInstance() }) };
};

const createCheckoutSession = async function (ctx) {
  const { state: { user: { sub: purchaser } }, request: { body } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  try {
    const result = await CrewmatePurchaseService.createCheckoutSession({
      productId: body.productId,
      purchaser,
      recipient: body.recipient,
      returnUrl: body.returnUrl,
      stripe: stripeInstance()
    });
    ctx.body = {
      checkoutSessionId: result.id,
      clientSecret: result.clientSecret,
      purchase: result.purchase
    };
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getPendingPurchase = async function (ctx) {
  const { state: { user: { sub: purchaser } } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');
  ctx.body = { purchase: await CrewmatePurchaseService.pendingPurchaseForPurchaser({ purchaser }) };
};

const getPurchaseByCheckoutSession = async function (ctx) {
  const { params: { checkoutSessionId }, state: { user: { sub: purchaser } } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');
  ctx.body = await CrewmatePurchaseService.resumeCheckoutSession({
    checkoutSessionId,
    purchaser,
    stripe: stripeInstance()
  });
};

const completeCustomization = async function (ctx) {
  const { state: { user: { sub: purchaser } }, request: { body } } = ctx;
  if (!purchaser) ctx.throw(401, 'Not authorized');

  try {
    ctx.body = {
      purchase: await CrewmatePurchaseService.completeGrantRequest({
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

if (isCrewmateProvisionerEnabled()) {
  router
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
    .use(cors({ origin: allowedOrigin }))
    .use(corsOrJwt)
    .get('/v2/crewmate-purchases/products', getProducts)
    .get('/v2/crewmate-purchases/pending', getPendingPurchase)
    .get('/v2/crewmate-purchases/checkout/:checkoutSessionId', getPurchaseByCheckoutSession)
    .post('/v2/crewmate-purchases/checkout', bodyParser(), createCheckoutSession)
    .post('/v2/crewmate-purchases/customization', bodyParser(), completeCustomization);
}

module.exports = router;
