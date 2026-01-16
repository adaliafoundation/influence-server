const { Entity } = require('@influenceth/sdk');
const router = require('@koa/router')();
const conditional = require('koa-conditional-get');
const etag = require('koa-etag');
const ratelimit = require('koa-ratelimit');
const { isWhiteList } = require('@api/plugins/origin');
const logger = require('@common/lib/logger');
const { AsteroidService, CrewService, CrewmateService, EntityService, ShipService } = require('@common/services');
const CdnAsteroidCard = require('@common/lib/cdn/AsteroidCard');
const CdnCrewCard = require('@common/lib/cdn/CrewCard');
const CdnCrewmateCard = require('@common/lib/cdn/CrewmateCard');
const CdnShipCard = require('@common/lib/cdn/ShipCard');
const { toBoolean } = require('@common/lib/utils');

const VALID_FILE_TYPES = {
  png: 'image/png',
  svg: 'image/svg+xml'
};

// Returns generated cards for any minted asteroid
const getAsteroidCard = async (ctx) => {
  const { params: { i: tokenId, fileType }, query: { height, width } } = ctx;
  if (!Object.keys(VALID_FILE_TYPES).includes(fileType)) {
    ctx.throw(400, `Unsupported file type. Valid file types: ${Object.keys(VALID_FILE_TYPES)}`);
  }

  const cdn = new CdnAsteroidCard();
  const asteroid = await EntityService.getEntity({
    id: tokenId, label: Entity.IDS.ASTEROID, components: ['Celestial', 'Orbit', 'Name'], format: true
  });

  if (!asteroid) ctx.throw(404, `No asteroid with id ${ctx.params.i} found`);

  try {
    const asset = await cdn.getAsset({ doc: asteroid, fileType });
    if (asset) {
      ctx.status = 302;
      ctx.redirect(cdn.getUrl({ fileType, key: asset.key, height, width }));
      return;
    }
  } catch (error) {
    logger.error(error);
  }

  const card = await AsteroidService.generateCard({ asteroidDoc: asteroid, fileType });

  if (!cdn.isEnabled()) {
    ctx.type = VALID_FILE_TYPES[fileType];
    ctx.body = card;

    return;
  }

  try {
    const asset = await cdn.upload({ contentType: VALID_FILE_TYPES[fileType], data: card, doc: asteroid, fileType });

    ctx.status = 302;
    ctx.redirect(cdn.getUrl({ fileType, key: asset.key, height, width }));
  } catch (error) {
    logger.inspect(error, 'error');
    ctx.throw(500, 'Error saving card to cdn');
  }
};

// Returns the generated crew card for each crew member as well as a bustOnly option
const getCrewmateCard = async (ctx) => {
  const { params: { i: tokenId, fileType }, query: { bustOnly: _bustOnly, height, options, width } } = ctx;
  if (!Object.keys(VALID_FILE_TYPES).includes(fileType)) {
    ctx.throw(400, `Unsupported file type. Valid file types: ${Object.keys(VALID_FILE_TYPES)}`);
  }

  if (fileType === 'svg' && (height || width)) {
    ctx.throw(400, 'Custom svg sizes are no longer supported, please use /:i/image.png');
  }

  const bustOnly = toBoolean(_bustOnly);
  const random = (tokenId === 'random');
  const provided = (tokenId === 'provided');
  let card;
  let crewmate;

  if (random) {
    card = await CrewmateService.generateCard({ crewmateDoc: {}, fileType, options: { bustOnly, random } });

    ctx.type = 'image/svg+xml';
    ctx.body = card;

    return;
  }

  if (provided) {
    try {
      crewmate = { Crewmate: JSON.parse(options) };
      card = await CrewmateService.generateCard({ crewmateDoc: crewmate, fileType, options: { bustOnly } });

      ctx.type = 'image/svg+xml';
      ctx.body = card;

      return;
    } catch (error) {
      throw ctx.throw(500, error.messsage || error);
    }
  }

  const cdn = new CdnCrewmateCard();
  crewmate = await EntityService.getEntity({
    id: tokenId, label: Entity.IDS.CREWMATE, components: ['Crewmate', 'Name'], format: true
  });

  if (!crewmate) ctx.throw(404, `No crewmate with id ${ctx.params.i} found`);

  if (cdn.isEnabled()) {
    try {
      const asset = await cdn.getAsset({ bustOnly, doc: crewmate, fileType });
      if (asset) {
        const assetUrl = cdn.getUrl({ fileType, key: asset.key, height, width });
        ctx.status = 302;
        ctx.redirect(assetUrl);
        return;
      }
    } catch (error) {
      logger.inspect(error, 'error');
    }
  }

  card = await CrewmateService.generateCard({ crewmateDoc: crewmate, fileType, options: { bustOnly } });
  if (!cdn.isEnabled()) {
    ctx.type = VALID_FILE_TYPES[fileType];
    ctx.body = card;
    return;
  }

  try {
    const asset = await cdn.upload({
      bustOnly,
      contentType: VALID_FILE_TYPES[fileType],
      data: card,
      doc: crewmate,
      fileType
    });

    ctx.status = 302;
    ctx.redirect(cdn.getUrl({ fileType, key: asset.key, height, width }));
  } catch (error) {
    ctx.throw(500, 'Error saving card to cdn');
  }
};

// Returns the generated crew card for the captain of the crew
const getCaptainCard = async (ctx) => {
  const tokenId = ctx.params.i;
  const crews = await EntityService.getEntities({
    id: tokenId, label: Entity.IDS.CREW, components: ['Crew'], format: true
  });

  if (!crews[0]) ctx.throw(404, `No crew with id ${ctx.params.i} found`);
  const captainId = crews[0].Crew.roster[0];

  if (!captainId) ctx.throw(404, `No captain found for crew with id ${ctx.params.i}`);
  ctx.params.i = captainId;
  return getCrewmateCard(ctx);
};

const getCrewCard = async (ctx) => {
  const { params: { i: tokenId, fileType }, query: { height, options, width } } = ctx;
  const crew = await EntityService.getEntity({
    id: tokenId, label: Entity.IDS.CREW, components: ['Crew'], format: true
  });

  if (!crew) ctx.throw(404, `No crew with id ${ctx.params.i} found`);
  const captainId = crew.Crew?.roster[0];

  if (!captainId) ctx.throw(404, `No captain found for crew with id ${ctx.params.i}`);

  // Retrieve captain's card
  const crewmate = await EntityService.getEntity({
    id: captainId, label: Entity.IDS.CREWMATE, components: ['Crewmate', 'Name'], format: true
  });

  if (!crewmate) ctx.throw(404, `No Crewmate found with id ${captainId}`);

  const cdn = new CdnCrewCard();

  if (cdn.isEnabled()) {
    try {
      const asset = await cdn.getAsset({ doc: crewmate, fileType });
      if (asset) {
        const assetUrl = cdn.getUrl({ fileType, key: asset.key, height, width });
        ctx.status = 302;
        ctx.redirect(assetUrl);
        return;
      }
    } catch (error) {
      logger.inspect(error, 'error');
    }
  }

  const card = await CrewService.generateCard({ crewmateDoc: crewmate, crewDoc: crew, fileType, options });
  if (!cdn.isEnabled()) {
    ctx.type = VALID_FILE_TYPES[fileType];
    ctx.body = card;
    return;
  }

  try {
    const asset = await cdn.upload({
      contentType: VALID_FILE_TYPES[fileType],
      data: card,
      doc: crew,
      fileType
    });

    ctx.status = 302;
    ctx.redirect(cdn.getUrl({ fileType, key: asset.key, height, width }));
  } catch (error) {
    ctx.throw(500, 'Error saving card to cdn');
  }
};

const getShipCard = async (ctx) => {
  const { params: { i: tokenId, fileType }, query: { height, options, width } } = ctx;
  const ship = await EntityService.getEntity({
    id: tokenId, label: Entity.IDS.SHIP, components: ['Ship', 'Name'], format: true
  });

  if (!ship) ctx.throw(404, `No ship with id ${ctx.params.i} found`);
  const cdn = new CdnShipCard();

  try {
    const asset = await cdn.getAsset({ doc: ship, fileType });
    if (asset) {
      const assetUrl = cdn.getUrl({ fileType, key: asset.key, height, width });
      ctx.status = 302;
      ctx.redirect(assetUrl);
      return;
    }
  } catch (error) {
    logger.inspect(error, 'error');
  }

  const card = await ShipService.generateCard({ ship, fileType, options });
  if (!cdn.isEnabled()) {
    ctx.type = VALID_FILE_TYPES[fileType];
    ctx.body = card;
    return;
  }

  try {
    const asset = await cdn.upload({
      contentType: VALID_FILE_TYPES[fileType],
      data: card,
      doc: ship,
      fileType
    });

    ctx.status = 302;
    ctx.redirect(cdn.getUrl({ fileType, key: asset.key, height, width }));
  } catch (error) {
    ctx.throw(500, 'Error saving card to cdn');
  }
};

// Add aggressive browser caching and ratelimiting for images
router.use(conditional());
router.use(etag());
router.use(ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 1000,
  errorMessage: 'Card images are rate-limited to 1 request per second',
  id: (ctx) => ((ctx.state.user && ctx.state.user.sub) ? ctx.state.user.sub : ctx.ip),
  max: 1,
  whitelist: isWhiteList
}));

router.get('/v1/asteroids/:i/image.:fileType', getAsteroidCard); // backwards compatibility
router.get('/v2/asteroids/:i/image.:fileType', getAsteroidCard);
router.get('/v1/crew/:i/image.:fileType', getCrewmateCard); // backwards compatibility
router.get('/v2/crewmates/:i/image.:fileType', getCrewmateCard);
router.get('/v2/crews/:i/captain/image.:fileType', getCaptainCard);
router.get('/v2/crews/:i/image.:fileType', getCrewCard);
router.get('/v2/ships/:i/image.:fileType', getShipCard);

module.exports = router;
