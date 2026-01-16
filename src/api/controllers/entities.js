const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const { flatten } = require('lodash');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const Entity = require('@common/lib/Entity');
const { allowedOrigin } = require('@api/plugins/origin');
const { ActivityService, EntityService } = require('@common/services');
const { toBoolean } = require('@common/lib/utils');

const getEntities = async function (ctx) {
  const { query: { components: rawComponents, label, match: rawMatch, id } } = ctx;

  const serviceParams = {};

  // only allow id OR match, not both
  if (id) {
    serviceParams.id = id.indexOf(',') > -1 ? id.split(',') : id;
  } else if (rawMatch) {
    const matchParts = rawMatch.split(':');
    try {
      serviceParams.match = { [matchParts.shift()]: JSON.parse(matchParts.join(':')) };
    } catch (error) {
      ctx.throw(400, `Invalid match parameter: ${rawMatch}`);
    }
  }

  // components
  if (rawComponents) serviceParams.components = rawComponents.split(',');

  // label
  let labels = null;

  try {
    labels = (label) ? label.split(',').map(Number) : [];
  } catch (error) {
    ctx.throw(400, `Invalid label (${label}) provided. Ignoring. (${error.message})`);
  }

  if (labels.length > 0) {
    try {
      const results = await Promise.all(labels.map(async (_label) => EntityService.getEntities({
        ...serviceParams, label: _label, format: true
      })));

      ctx.body = flatten(results);
    } catch (error) {
      ctx.throw(400, error.message);
    }
  } else {
    try {
      const results = await EntityService.getEntities({ ...serviceParams, format: true });
      ctx.body = results;
    } catch (error) {
      ctx.throw(400, error.message);
    }
  }
};

const getEntity = async function (ctx) {
  const { query: { components: rawComponents }, params: { uuid } } = ctx;
  const components = (rawComponents) ? rawComponents.split(',') : null;

  try {
    const results = await EntityService.getEntity({ uuid, components, format: true });
    ctx.body = results;
  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: error.message || error };
  }
};

const getEntityActivity = async function (ctx) {
  const { params: { uuid } } = ctx;
  const order = (['ASC', 'DESC'].includes(ctx.query?.order?.toUpperCase())) ? ctx.query?.order?.toUpperCase() : 'DESC';
  const eventNames = ctx.query.events ? ctx.query.events.split(',') : null;
  const page = Number(ctx.query.page) || 1;
  const pageSize = Number(ctx.query.pageSize) || 50;
  const returnTotal = (ctx.query.returnTotal) ? !!ctx.query.returnTotal : true;
  const since = Number(ctx.query.since) || 0;
  const withAnnotations = toBoolean(ctx.query.withAnnotations);
  const unresolved = toBoolean(ctx.query.unresolved);
  let entity;

  try {
    entity = Entity.fromUuid(uuid);
  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid entity uuid' };
    return;
  }
  const { docs, totalCount } = await ActivityService.findForEntity(
    entity,
    { order, page, pageSize, withAnnotations, returnTotal, since, unresolved, eventNames }
  );

  ctx.status = 200;
  ctx.set('Total-Hits', totalCount);
  ctx.body = docs;
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin, exposeHeaders: ['Total-Hits'] }))
  .use(corsOrJwt)
  .get('/v2/entities', getEntities)
  .get('/v2/entities/:uuid', getEntity)
  .get('/v2/entities/:uuid/activity', getEntityActivity);

module.exports = router;
