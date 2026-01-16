const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { CrossingService, SwayCrossingService } = require('@common/services');

const getCrossings = async (ctx) => {
  const { query } = ctx;
  const crossings = await CrossingService.find(query);

  ctx.type = 'application/json';
  ctx.body = crossings;
};

const getSwayCrossings = async (ctx) => {
  const { query } = ctx;
  const crossings = await SwayCrossingService.find(query);

  ctx.type = 'application/json';
  ctx.body = crossings;
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/crossings', getCrossings)
  .get('/v2/swaycrossings', getSwayCrossings);

module.exports = router;
