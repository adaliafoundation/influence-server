const KoaRouter = require('@koa/router');
const appConfig = require('config');
const mongoose = require('mongoose');
const { getMode, isHybrid } = require('@common/lib/gameMode');

const router = new KoaRouter();

router.get('/v2/health', async (ctx) => {
  const checks = {};

  // MongoDB
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  checks.mongodb = {
    status: mongoose.connection.readyState === 1 ? 'ok' : 'error',
    readyState: mongoose.connection.readyState
  };

  // Elasticsearch (optional - just check if configured)
  try {
    const esUri = appConfig.get('Elasticsearch.uri');
    checks.elasticsearch = { status: esUri ? 'configured' : 'not_configured' };
  } catch (e) {
    checks.elasticsearch = { status: 'not_configured' };
  }

  // Game mode
  checks.gameMode = {
    mode: getMode(),
    hybrid: isHybrid()
  };

  // World fork (hybrid only)
  if (isHybrid()) {
    try {
      const fork = await mongoose.model('WorldFork').findOne({}).lean();
      checks.worldFork = fork
        ? { status: 'ok', block: fork.blockNumber, label: fork.label, forkedAt: fork.forkedAt }
        : { status: 'missing' };
    } catch (e) {
      if (e.name === 'MissingSchemaError') {
        // WorldFork model may not be registered yet (pre-Phase 6)
        checks.worldFork = { status: 'not_available' };
      } else {
        checks.worldFork = { status: 'error', message: e.message };
      }
    }
  }

  const allOk = checks.mongodb.status === 'ok'
    && (!isHybrid() || checks.worldFork?.status === 'ok');

  ctx.status = allOk ? 200 : 503;
  ctx.body = { status: allOk ? 'ok' : 'degraded', checks };
});

module.exports = router;
