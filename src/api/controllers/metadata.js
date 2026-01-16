const KoaRouter = require('@koa/router');
const Entity = require('@common/lib/Entity');
const { EntityService, MetadataService } = require('@common/services');

// Returns a single asteroid with all of its metadata adhering to ERC-721 and OpenSea standards
const getAsteroidMetadata = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const asteroid = await EntityService.getEntity({
    id,
    label: Entity.IDS.ASTEROID,
    components: ['Celestial', 'Orbit', 'Name', 'AsteroidReward'],
    format: true
  });

  if (!asteroid) ctx.throw(404, `No asteroid with id ${id} found`);

  try {
    const metadata = await MetadataService.getAsteroidMetadata({
      entity: asteroid,
      originUrl: origin,
      includeDynamicData: true
    });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getAsteroidMetadataStatic = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const asteroid = await EntityService.getEntity({
    id,
    label: Entity.IDS.ASTEROID,
    components: ['Celestial', 'Orbit', 'Name', 'AsteroidReward'],
    format: true
  });

  if (!asteroid) ctx.throw(404, `No asteroid with id ${id} found`);

  try {
    const metadata = await MetadataService.getAsteroidMetadata({
      entity: asteroid,
      originUrl: origin,
      includeDynamicData: false
    });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

// Returns metadata for each crewmate
const getCrewmateMetadata = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const crewmate = await EntityService.getEntity({
    id,
    label: Entity.IDS.CREWMATE,
    components: ['Crewmate', 'CrewmateReward', 'Name'],
    format: true
  });

  if (!crewmate) ctx.throw(404, `No crewmate with id ${ctx.params.i} found`);

  try {
    const metadata = await MetadataService.getCrewmateMetadata({
      entity: crewmate,
      originUrl: origin,
      includeDynamicData: true
    });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getCrewmateMetadataStatic = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const crewmate = await EntityService.getEntity({
    id,
    label: Entity.IDS.CREWMATE,
    components: ['Crewmate', 'CrewmateReward', 'Name'],
    format: true
  });

  if (!crewmate) ctx.throw(404, `No crewmate with id ${ctx.params.i} found`);

  try {
    const metadata = await MetadataService.getCrewmateMetadata({
      entity: crewmate,
      originUrl: origin,
      includeDynamicData: false
    });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getCrewMetadata = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const crew = await EntityService.getEntity({
    id,
    label: Entity.IDS.CREW,
    components: ['Crew', 'Name'],
    format: true
  });

  if (!crew) ctx.throw(404, `No crew with id ${ctx.params.i} found`);

  try {
    const metadata = await MetadataService.getCrewMetadata({ entity: crew, originUrl: origin });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getShipMetadata = async (ctx) => {
  const { params: { i: id }, request: { origin } } = ctx;
  const ship = await EntityService.getEntity({
    id,
    label: Entity.IDS.SHIP,
    components: ['Ship', 'Name'],
    format: true
  });

  if (!ship) ctx.throw(404, `No ship with id ${id} found`);

  try {
    const metadata = await MetadataService.getShipMetadata({ entity: ship, originUrl: origin });
    ctx.type = 'application/json';
    ctx.body = metadata;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const router = new KoaRouter()
  .get('/v1/metadata/asteroids/:i', getAsteroidMetadata) // backwards compatibility
  .get('/v2/metadata/asteroids/:i', getAsteroidMetadata)
  .get('/v1/metadata/crew/:i', getCrewmateMetadata) // backwards compatibility
  .get('/v2/metadata/crewmates/:i', getCrewmateMetadata)
  .get('/v2/metadata/crews/:i', getCrewMetadata)
  .get('/v2/metadata/ships/:i', getShipMetadata)
  .get('/v2/metadata-static/asteroids/:i', getAsteroidMetadataStatic)
  .get('/v2/metadata-static/crewmates/:i', getCrewmateMetadataStatic);

module.exports = router;
