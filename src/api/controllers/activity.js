const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const { allowedOrigin } = require('@api/plugins/origin');
const { ActivityService } = require('@common/services');
const { EthereumBlockCache, StarknetBlockCache } = require('@common/lib/cache');

const getActivities = async function (ctx) {
  const txHashes = (ctx.query.txHash) ? ctx.query.txHash.split(',') : [];
  if (txHashes.length === 0) ctx.throw(400, 'Missing txHash query param');

  const { docs } = await ActivityService.find({
    filter: { 'event.transactionHash': { $in: txHashes } }
  });

  ctx.status = 200;
  ctx.set('Eth-Block-Number', await EthereumBlockCache.getCurrentBlockNumber());
  ctx.set('Starknet-Block-Number', await StarknetBlockCache.getCurrentBlockNumber());
  ctx.body = docs;
};

const getOngoingActivities = async function (ctx) {
  const { params: { asteroid }, query: { page, pageSize } } = ctx;
  if (!asteroid) ctx.throw(400, 'Missing asteroid query param');

  const { docs } = await ActivityService.findOngoing({ asteroid, page, pageSize });

  ctx.status = 200;
  ctx.body = docs;
};

const router = new KoaRouter()
  .use(cors({ origin: allowedOrigin }))
  .get('/v2/activity', getActivities)
  .get('/v2/activity/ongoing/:asteroid', getOngoingActivities);

module.exports = router;
