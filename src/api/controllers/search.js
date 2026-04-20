const appConfig = require('config');
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { client: esClient } = require('@common/storage/elasticsearch');
const { isHybrid } = require('@common/lib/gameMode');
const { EntityService } = require('@common/services');

// Map ES index names to entity labels
const INDEX_TO_LABEL = {
  asteroid: 3,
  crew: 1,
  crewmate: 2,
  building: 5,
  ship: 6,
  deposit: 7,
  delivery: 9,
  lot: 4
};

const hybridSearch = async function (ctx) {
  const { params: { index } } = ctx;
  if (!index) ctx.throw(404, 'Missing or invalid index');

  const label = INDEX_TO_LABEL[index];
  if (!label) {
    // Unknown index — return empty results
    ctx.body = { hits: { hits: [], total: { value: 0 } } };
    return;
  }

  const results = await EntityService.getEntities({ label, format: true });
  ctx.body = {
    hits: {
      hits: (results || []).map((r) => ({ _source: r })),
      total: { value: (results || []).length }
    }
  };
};

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
  .post('/:index', isHybrid() ? hybridSearch : search);

module.exports = router;
