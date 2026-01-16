const appConfig = require('config');
const router = require('@koa/router')();
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const { allowedOrigin } = require('@api/plugins/origin');

const createReferral = async (ctx) => {
  ctx.throw(501, 'Not longer supported');
};

// Setup routes
router.use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }));
router.use(cors({ origin: allowedOrigin }));
router.use(bodyParser());
router.post('/v1/user/referrals', createReferral);
router.post('/v2/user/referrals', createReferral);

module.exports = router;
