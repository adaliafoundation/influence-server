const appConfig = require('config');
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { client: esClient } = require('@common/storage/elasticsearch');

const search = async function (ctx) {
  const { params: { index }, request: { body } } = ctx;
  if (!index) ctx.throw(404, 'Missing or invalid index');
  ctx.body = await esClient.search({ index, body });
};

const router = new KoaRouter({ prefix: '/_search' })
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .use(bodyParser())
  .post('/:index', search);

module.exports = router;
