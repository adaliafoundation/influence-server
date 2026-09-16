const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const { allowedOrigin } = require('@api/plugins/origin');
const { isBanxaCheckoutEnabled } = require('@common/lib/officialFeatures');
const { BanxaService } = require('@common/services');

const createCheckout = async function (ctx) {
  if (!BanxaService.isConfigured()) ctx.throw(503, 'Banxa checkout unavailable');

  try {
    ctx.body = {
      order: await BanxaService.createCheckout({
        body: ctx.request.body,
        userAddress: ctx.state.user.sub
      })
    };
  } catch (error) {
    ctx.throw(error.name === 'ValidationError' ? 400 : 502, error.message);
  }
};

const getOrder = async function (ctx) {
  if (!BanxaService.isConfigured()) ctx.throw(503, 'Banxa checkout unavailable');

  try {
    ctx.body = {
      order: await BanxaService.orderForUser({
        orderId: ctx.params.orderId,
        userAddress: ctx.state.user.sub
      })
    };
  } catch (error) {
    ctx.throw(error.name === 'ValidationError' ? 404 : 502, error.message);
  }
};

const router = new KoaRouter();

if (isBanxaCheckoutEnabled()) {
  router
    .use(cors({ origin: allowedOrigin }))
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret') }))
    .post('/v2/banxa/checkout', bodyParser(), createCheckout)
    .get('/v2/banxa/orders/:orderId', getOrder);
}

module.exports = router;
