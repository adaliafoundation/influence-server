const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { SwayClaimService } = require('@common/services');

const getClaims = async (ctx) => {
  const { params: { address } } = ctx;
  const docs = await SwayClaimService.findByAddress(address);
  ctx.body = docs;
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin, exposeHeaders: ['Total-Hits'] }))
  .use(corsOrJwt)
  .get('/v2/claims/:address', getClaims);

module.exports = router;
