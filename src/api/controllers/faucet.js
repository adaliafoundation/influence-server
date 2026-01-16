const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const FaucetService = require('@common/services/Faucet');
const UserService = require('@common/services/User');

const faucetInfo = async (ctx) => {
  const user = await UserService.findByAddress(ctx.state.user.sub);

  if (!user) {
    ctx.status = 404;
    return;
  }

  const info = await FaucetService.getFaucetInfo({ recipient: user.address });
  ctx.type = 'application/json';
  ctx.body = info;
};

const claimTokens = async (ctx) => {
  // Only allow in prerelease and staging environments
  if (!['prerelease', 'staging'].includes(appConfig.util.getEnv('NODE_ENV'))) {
    ctx.status = 404;
    return;
  }

  const user = await UserService.findByAddress(ctx.state.user.sub);

  if (!user) {
    ctx.status = 404;
    return;
  }

  const { params: { token } } = ctx;
  let txHash;

  try {
    txHash = await FaucetService.recordClaim({ recipient: user.address, token });
  } catch (e) {
    ctx.status = 400;
    ctx.body = e.message;
    return;
  }

  ctx.status = 200;
  ctx.body = txHash;
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: false }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/faucet', faucetInfo)
  .post('/v2/faucet/:token', claimTokens);

module.exports = router;
