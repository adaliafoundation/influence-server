const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const ratelimit = require('koa-ratelimit');
const { allowedOrigin } = require('@api/plugins/origin');
const { isAvnuPaymasterEnabled } = require('@common/lib/officialFeatures');
const logger = require('@common/lib/logger');
const { AvnuPaymasterService } = require('@common/services');

const paymasterRateLimit = ratelimit({
  db: new Map(),
  driver: 'memory',
  duration: 60000,
  id: (ctx) => ctx.state.user.sub,
  max: Number(appConfig.get('Avnu.rateLimitPerMinute'))
});

const proxyPaymasterRequest = async function (ctx) {
  if (!AvnuPaymasterService.isConfigured()) ctx.throw(503, 'Paymaster unavailable');

  try {
    const response = await AvnuPaymasterService.forward({
      body: ctx.request.body,
      userAddress: ctx.state.user.sub
    });

    ctx.status = response.status;
    ctx.body = response.data;
  } catch (error) {
    if (error.name === 'ValidationError') ctx.throw(400, error.message);

    logger.error(`AVNU_PAYMASTER_PROXY_FAILED method=${ctx.request.body?.method || 'unknown'} reason=${error.message}`);
    ctx.throw(502, 'Paymaster request failed');
  }
};

const router = new KoaRouter();

if (isAvnuPaymasterEnabled()) {
  router
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret') }))
    .use(cors({ origin: allowedOrigin }))
    .use(paymasterRateLimit)
    .post('/v2/paymaster', bodyParser(), proxyPaymasterRequest);
}

module.exports = router;
