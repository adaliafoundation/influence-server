require('module-alias/register');
require('dotenv').config({ silent: true });
const { range, without } = require('lodash');
const { eachLimit } = require('async');
const logger = require('@common/lib/logger');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const moment = require('moment');
const { mongoose } = require('@common/storage/db');
const { Entity, Lot, Permission } = require('@influenceth/sdk');
const { PackedLotDataService } = require('@common/services');

const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const lotsWithBuildings = async function () {
  const results = new Set();
  const cursor = await mongoose.model('LocationComponent').find({
    'entity.label': { $in: [Entity.IDS.BUILDING, Entity.IDS.SHIP] },
    'locations.label': Entity.IDS.LOT
  })
    .select('locations')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const lot = doc.locations.find(({ label }) => label === Entity.IDS.LOT);
    results.add(lot.id);
  }

  return results;
};

const lotsWithCrew = async function () {
  const results = new Set();
  const cursor = mongoose.model('LocationComponent').find(
    { 'locations.label': Entity.IDS.LOT, 'entity.label': Entity.IDS.CREW }
  )
    .select('locations')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const lot = doc.locations.find(({ label }) => label === Entity.IDS.LOT);
    results.add(lot.id);
  }

  return results;
};

const lotsWithAgreements = async function () {
  const results = new Set();
  const prepaidAgreementsCursor = mongoose.model('PrepaidAgreementComponent').find({
    permission: Permission.IDS.LOT_USE,
    endTime: { $gt: moment().unix() }
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await prepaidAgreementsCursor.next(); doc != null; doc = await prepaidAgreementsCursor.next()) {
    results.add(doc.entity.id);
  }

  const contractAgreementsCursor = mongoose.model('ContractAgreementComponent').findOne({
    permission: Permission.IDS.LOT_USE
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await contractAgreementsCursor.next(); doc != null; doc = await prepaidAgreementsCursor.next()) {
    results.add(doc.entity.id);
  }

  return results;
};

const lotsWithPolicies = async function () {
  const results = new Set();

  let cursor = mongoose.model('PrepaidMerklePolicyComponent').find({ permission: Permission.IDS.LOT_USE })
    .select('entity lotIndices')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    doc.lotIndices?.forEach((lotIndex) => {
      results.add(Lot.toId(doc.entity.id, lotIndex));
    });
  }

  cursor = mongoose.model('ContractPolicyComponent').find({
    'entity.label': Entity.IDS.LOT,
    permission: Permission.IDS.LOT_USE
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  cursor = mongoose.model('PrepaidPolicyComponent').find({
    'entity.label': Entity.IDS.LOT,
    permission: Permission.IDS.LOT_USE
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  cursor = mongoose.model('PublicPolicyComponent').find({
    'entity.label': Entity.IDS.LOT,
    permission: Permission.IDS.LOT_USE
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  return results;
};

const getLotsToBuild = async function () {
  const results = await Promise.all([
    lotsWithBuildings(),
    lotsWithCrew(),
    lotsWithAgreements(),
    lotsWithPolicies()
  ]);
  const lotIds = new Set([...results[0], ...results[1], ...results[2], ...results[3]]);
  return [...lotIds].map((id) => ({ id, label: Entity.IDS.LOT }));
};

const main = async function ({ asteroids, lots, initEmpty } = {}) {
  if (asteroids) {
    for (const asteroid of asteroids) {
      logger.info(`building packed lot data for asteroid ${asteroid}`);
      await PackedLotDataService.build({ id: asteroid, label: Entity.IDS.ASTEROID }, true);
    }
    return;
  }

  let lotsToBuild;
  if (lots) {
    lotsToBuild = lots.map((id) => ({ id, label: Entity.IDS.LOT }));
  } else {
    // get a list of all the lots to build
    lotsToBuild = await getLotsToBuild();
  }

  // If initEmpty, intialize all other asteroids with empty packed lot data
  if (initEmpty) {
    const asteroidsToBuild = new Set();
    lotsToBuild.forEach((lot) => {
      const { asteroidId } = Lot.toPosition(lot);
      asteroidsToBuild.add(asteroidId);
    });
    const asteroidsToInit = without(range(1, 250_001), ...asteroidsToBuild);

    logger.info('Initializing packed lot data for asteroids...');
    await eachLimit(asteroidsToInit, 100, async (id) => {
      logger.debug(`init packed lot data for asteroid ${id}`);
      await PackedLotDataService.initForAsteroid({ id, label: Entity.IDS.ASTEROID });
    });
  }

  let index = 1;
  const cache = {};
  for (const lot of lotsToBuild) {
    const { asteroidId, lotIndex } = Lot.toPosition(lot);
    logger.info(`building packed lot data for ${index}/${lotsToBuild.length} `
      + `lotIndex: ${lotIndex} of asteroid: ${asteroidId}`);
    cache[asteroidId] = await PackedLotDataService.update(lot, cache[asteroidId]);

    index += 1;
  }
};

const args = yargs(hideBin(process.argv))
  .option('asteroids', {
    alias: 'a',
    type: 'array'
  })
  .option('lots', {
    alias: 'l',
    type: 'array'
  })
  .option('initEmpty', {
    alias: 'i',
    type: 'boolean',
    default: false,
    description: 'Initialize all asteroids with empty packed lot data'
  })
  .parse();

main(args)
  .then(done)
  .catch(done);
