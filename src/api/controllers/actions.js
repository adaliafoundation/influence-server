const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const { allowedOrigin } = require('@api/plugins/origin');
const { isHybrid } = require('@common/lib/gameMode');
const logger = require('@common/lib/logger');

const VALID_ACTION_NAME = /^[a-z][a-z0-9_]{0,63}$/;

// Lazy-require GameEngine so the controller can load before Phase 4 is built.
let _GameEngine;
function getGameEngine() {
  // eslint-disable-next-line global-require, import/no-unresolved
  if (!_GameEngine) _GameEngine = require('@common/gameLogic/GameEngine');
  return _GameEngine;
}

const router = new KoaRouter();

// Only register action routes in hybrid mode.
// In chain mode this exports an empty router - the server loop still
// iterates it, but it has no routes so it matches nothing.
if (isHybrid()) {
  router
    .use(koaJwt({ secret: appConfig.get('App.jwtSecret') }))
    .use(cors({ origin: allowedOrigin }))
    .use(bodyParser())
    .post('/v2/actions/:action', async (ctx) => {
      const { params: { action }, request: { body }, state: { user: { sub: address } } } = ctx;
      if (!VALID_ACTION_NAME.test(action)) {
        ctx.throw(400, `Invalid action name: "${action}"`);
      }
      const idempotencyKey = ctx.get('X-Idempotency-Key') || null;

      const { callerCrew, vars, meta } = body || {};
      if (callerCrew !== undefined && (typeof callerCrew !== 'object' || callerCrew === null || Array.isArray(callerCrew))) {
        ctx.throw(400, 'callerCrew must be an object');
      }
      if (vars !== undefined && (typeof vars !== 'object' || vars === null || Array.isArray(vars))) {
        ctx.throw(400, 'vars must be an object');
      }
      if (meta !== undefined && (typeof meta !== 'object' || meta === null || Array.isArray(meta))) {
        ctx.throw(400, 'meta must be an object');
      }

      try {
        const result = await getGameEngine().execute({
          action,
          address,
          callerCrew,
          vars,
          meta,
          idempotencyKey
        });

        ctx.status = 200;
        ctx.body = result;
      } catch (error) {
        if (error.codeName === 'WriteConflict') {
          ctx.status = 409;
          ctx.body = { error: 'Conflict - retry the action', retryable: true };
        } else if (error.name === 'ValidationError') {
          ctx.status = 400;
          ctx.body = { error: error.message };
        } else {
          logger.error(`Action "${action}" failed for ${address}:`, error);
          ctx.status = 500;
          ctx.body = { error: 'Internal server error' };
        }
      }
    });
}

module.exports = router;
