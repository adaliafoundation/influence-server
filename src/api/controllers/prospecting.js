const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const Prospecting = require('@common/services/Prospecting');

const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/prospecting/campaigns', async (ctx) => {
    try {
      ctx.body = await Prospecting.list({ ...ctx.query, page: Number(ctx.query.page || 1) });
    } catch (error) {
      ctx.throw(400, error.message);
    }
  })
  .get('/v2/prospecting/campaigns/:id', async (ctx) => {
    let result;
    try { result = await Prospecting.get(ctx.params.id); } catch (error) { ctx.throw(400, error.message); }
    if (!result) ctx.throw(404, 'Prospecting campaign not indexed');
    ctx.body = result;
  });
module.exports = router;
