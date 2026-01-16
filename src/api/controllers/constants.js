const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { ConstantService } = require('@common/services');

const getConstant = async function (ctx) {
  const { params: { name } } = ctx;
  const names = name.split(',');
  const results = await ConstantService.getConstants(names);

  ctx.body = results.reduce((acc, result) => {
    acc[result.name] = result.value;
    return acc;
  }, {});
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/constants/:name', getConstant);

module.exports = router;
