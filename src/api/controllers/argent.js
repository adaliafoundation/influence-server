const appConfig = require('config');
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const { allowedOrigin } = require('@api/plugins/origin');
const { ArgentService } = require('@common/services');

const deployAccount = async function (ctx) {
  const { request: { body } } = ctx;

  try {
    const result = await ArgentService.deployAccount(body);

    ctx.type = 'application/json';
    ctx.body = result.data;
  } catch (error) {
    ctx.throw(500, error.message);
  }
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret') }))
  .use(cors({ origin: allowedOrigin }))
  .use(bodyParser())
  .post('/v2/argent/account/deploy', deployAccount);

module.exports = router;
