const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const { allowedOrigin } = require('@api/plugins/origin');

const getPackedData = async (ctx) => {
  const { params: { asteroidId } } = ctx;

  const asteroid = Entity.Asteroid(asteroidId);
  const packedData = await PackedLotDataService.get(asteroid);
  if (!packedData) ctx.throw(404, `No data found for ${asteroidId}`);

  const uintArray = new Uint32Array(packedData.valueOf());

  ctx.type = 'application/octet-stream';
  ctx.body = Buffer.from(uintArray.buffer);
};

const router = new KoaRouter({ prefix: '/v2/asteroids/:asteroidId' })
  .use(cors({ origin: allowedOrigin }))
  .use(bodyParser())
  .get('/lots/packed', getPackedData);

module.exports = router;
