const router = require('@koa/router')();

const useEntities = async (ctx) => {
  ctx.status = 301;
  ctx.type = 'application/json';
  ctx.body = { message: 'No longer supported. Please use /v2/entities instead.' };
};

const useSDK = async (ctx) => {
  ctx.status = 301;
  ctx.type = 'application/json';
  ctx.body = { message: 'No longer supported. Please use Influence SDK instead.' };
};

const noLongerSupported = async (ctx) => {
  ctx.status = 301;
  ctx.type = 'application/json';
  ctx.body = { message: 'No longer supported.' };
};

// Asteroids
router.get('/asteroids', noLongerSupported);
router.get('/asteroids/:i', useEntities);
router.get('/v1/asteroids', noLongerSupported);
router.get('/v1/asteroids/:i', useEntities);
router.get('/v1/asteroids/ownedCount', noLongerSupported);
router.get('/v1/asteroids/:id/lots/occupier/:crewId', useEntities);
router.get('/v1/asteroids/:id/lots/sampled/:crewId/:resourceId', useEntities);
router.get('/v1/asteroids/:id/lots/:i', useEntities);

// Books
router.get('/v1/books', useSDK);
router.get('/v1/books/:book', useSDK);

// Planets
router.get('/v1/planets', useSDK);
router.get('/v1/planets/:i', useSDK);

module.exports = router;
