const appConfig = require('config');
const KoaRouter = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const Entity = require('@common/lib/Entity');
const { EventAnnotationService } = require('@common/services');

const createAnnotation = async function (ctx) {
  const {
    request: { body: { annotation, transactionHash, logIndex, crewId } },
    state: { user: { sub: caller } }
  } = ctx;
  const resolvedCrewId = crewId || ctx.get('x-crew-id');
  if (!resolvedCrewId) ctx.throw(400, 'Missing or invalid crew id');
  if (!caller) ctx.throw(401, 'Not authorized');

  try {
    const result = await EventAnnotationService.findOrCreate({
      annotation,
      caller,
      callerCrew: Entity.Crew(Number(resolvedCrewId)),
      event: { transactionHash, logIndex },
      pin: true
    });

    ctx.status = 200;
    ctx.body = result;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getHash = async function (ctx) {
  const { request: { body: { annotation } } } = ctx;
  ctx.status = 200;
  try {
    await EventAnnotationService.validate(annotation);
  } catch (error) {
    ctx.throw(400, error.message);
  }

  const hash = await EventAnnotationService.hashData(annotation);

  ctx.status = 200;
  ctx.body = { hash };
};

const getAnnotations = async function (ctx) {
  const { query: { transactionHash, logIndex } } = ctx;
  ctx.status = 200;
  ctx.body = await EventAnnotationService.findByEvent({ transactionHash, logIndex });
};

const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .use(bodyParser())
  .post('/v2/annotations/hash', getHash)
  .post('/v2/annotations', createAnnotation)
  .get('/v2/annotations', getAnnotations);

module.exports = router;
