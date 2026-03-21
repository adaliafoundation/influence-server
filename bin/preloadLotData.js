require('module-alias/register');
require('dotenv').config({ silent: true });
const { range, without } = require('lodash');
const { eachLimit } = require('async');
const logger = require('@common/lib/logger');
const { Timer } = require('timer-node');
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
    permission: Permission.IDS.USE_LOT,
    endTime: { $gt: moment().unix() }
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await prepaidAgreementsCursor.next(); doc != null; doc = await prepaidAgreementsCursor.next()) {
    results.add(doc.entity.id);
  }

  const contractAgreementsCursor = mongoose.model('ContractAgreementComponent').findOne({
    permission: Permission.IDS.USE_LOT
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

  let cursor = mongoose.model('PrepaidMerklePolicyComponent').find({ permission: Permission.IDS.USE_LOT })
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
    permission: Permission.IDS.USE_LOT
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  cursor = mongoose.model('PrepaidPolicyComponent').find({
    'entity.label': Entity.IDS.LOT,
    permission: Permission.IDS.USE_LOT
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  cursor = mongoose.model('PublicPolicyComponent').find({
    'entity.label': Entity.IDS.LOT,
    permission: Permission.IDS.USE_LOT
  })
    .select('entity')
    .lean()
    .cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    results.add(doc.entity.id);
  }

  return results;
};

const asteroidsWithLeasePolicies = async function () {
  const results = new Set();

  logger.debug(`asteroid: ${Entity.IDS.ASTEROID} ; permission: ${1}`)

  let cursor = mongoose.model('PrepaidPolicyComponent').find({
    'entity.label': Entity.IDS.ASTEROID,
    permission: Permission.IDS.USE_LOT
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

const main = async function ({ asteroids, lots, initEmpty, setLeaseStatus } = {}) {
  const timer = new Timer();
  timer.start();

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

  // If initEmpty, intialize all asteroids with empty packed lot data
  if (initEmpty) {
    const asteroidsToInit = range(1, 250_001);

    logger.info(`Initializing packed lot data for ${asteroidsToInit.length} asteroids...`);
    await eachLimit(asteroidsToInit, 100, async (id) => {
      logger.debug(`init packed lot data for asteroid ${id}`);
      await PackedLotDataService.initForAsteroid({ id, label: Entity.IDS.ASTEROID });
    });
  }

  // If setLeaseStatus, set asteroids with lease policy as leasable for all lots (the next step will overwrite specific non-leasable lots)
  if (setLeaseStatus) {
    const asteroidsToInit = await asteroidsWithLeasePolicies();

    logger.info(`Setting lease status lot data for ${asteroidsToInit.size} asteroids...`);
    await eachLimit(asteroidsToInit, 100, async (id) => {
      logger.debug(`set lease status lot data for asteroid ${id}`);
      await PackedLotDataService.initForLeasableAsteroid({ id, label: Entity.IDS.ASTEROID });
    });
  }

  let index = 1;
  const cache = {};
  logger.info(`Building lot data for ${lotsToBuild.length} lots...`);
  for (const lot of lotsToBuild) {
    const { asteroidId, lotIndex } = Lot.toPosition(lot);
    logger.debug(`build packed lot data for ${index}/${lotsToBuild.length} `
      + `lotIndex: ${lotIndex} of asteroid: ${asteroidId}`);
    cache[asteroidId] = await PackedLotDataService.update(lot, cache[asteroidId], false);

    index += 1;
  }
  logger.info(`Saving lot data for ${Object.entries(cache).length} asteroids...`);
  for (const [id, data] of Object.entries(cache)) {
    logger.debug(`save packed data for asteroid: ${id}`);
    await PackedLotDataService._cacheSet({ id: id, label: Entity.IDS.ASTEROID }, data);
  }

  timer.stop();
  logger.info(`Total duration: ${timer.format()}`);
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
  .option('setLeaseStatus', {
    alias: 's',
    type: 'boolean',
    default: false,
    description: 'Initialize lot lease status for asteroids with policy'
  })
  .parse();

main(args)
  .then(done)
  .catch(done);
