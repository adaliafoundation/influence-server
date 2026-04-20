const KoaRouter = require('@koa/router');
const mongoose = require('mongoose');
const { isHybrid } = require('@common/lib/gameMode');

const router = new KoaRouter();

// Only register in hybrid mode — chain mode has no fork concept
if (isHybrid()) {
  router.get('/v2/world', async (ctx) => {
    const fork = await mongoose.model('WorldFork').findOne({}).lean();
    if (!fork) {
      ctx.status = 404;
      ctx.body = { error: 'No world fork found' };
      return;
    }
    ctx.status = 200;
    ctx.body = {
      forkBlock: fork.blockNumber,
      forkBlockHash: fork.blockHash,
      forkBlockTimestamp: fork.blockTimestamp,
      forkedAt: fork.forkedAt,
      label: fork.label
    };
  });
}

module.exports = router;
