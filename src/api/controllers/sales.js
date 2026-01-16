const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { AsteroidSaleService, ConstantService } = require('@common/services');

const getAsteroidSale = async function (ctx) {
  const [asteroidSaleDoc, constantDoc] = await Promise.all([
    AsteroidSaleService.getLatest(),
    ConstantService.getConstant('ASTEROID_SALE_LIMIT')
  ]);

  ctx.body = {
    period: asteroidSaleDoc?.period || 0,
    volume: asteroidSaleDoc?.volume || 0,
    limit: constantDoc?.value || 0
  };
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/sales/asteroid', getAsteroidSale);

module.exports = router;
