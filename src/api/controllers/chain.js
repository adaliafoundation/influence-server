const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { StarknetBlockCache } = require('@common/lib/cache');

const getChainStatus = async (ctx) => {
  const chainInfo = {
    l1AcceptedBlock: await StarknetBlockCache.getl1AcceptedBlock()
  };

  ctx.type = 'application/json';
  ctx.body = chainInfo;
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/chain', getChainStatus);

module.exports = router;
