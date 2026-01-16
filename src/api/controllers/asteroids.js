const router = require('@koa/router')();
const { Asteroid } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');

// Specifically formatted to return lot ownership per user in the format expected by Snapshot API strategy
const getLotOwnership = async (ctx) => {
  const { query: { addresses } = {} } = ctx;
  const owners = (addresses) ? addresses.split(',') : [];
  const _scores = {};

  for (const owner of owners) {
    const asteroids = await EntityService.getEntities({
      label: 3,
      match: { 'Nft.owners.ethereum': owner },
      format: true
    });

    asteroids.forEach((asteroid) => {
      _scores[owner] = _scores[owner] || 0;
      _scores[owner] += Asteroid.Entity.getSurfaceArea(asteroid);
    });
  }

  const scores = Object.entries(_scores).map((kv) => ({ address: kv[0], score: kv[1].toString() }));
  ctx.type = 'application/json';
  ctx.body = { score: scores };
};

// Lot Ownership should be accessible publicly without CORS
router.get('/v1/asteroids/lotOwnership', getLotOwnership);

module.exports = router;
