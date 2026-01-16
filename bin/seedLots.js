/**
 * For each asteroid:
 * 1) Add region data for each existing lot
 * 2) create any missing lots with their respective region
*/

require('module-alias/register');
require('dotenv').config({ silent: true });
const { eachOfLimit } = require('async');
const { mongoose } = require('@common/storage/db');

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const createUpdateLots = async function (asteroid) {
  logger.debug(`Processing asteroid: ${asteroid.i}...`);
  const lotCount = asteroid.lots;
  const bulkActions = [];
  for (let i = 1; i <= lotCount; i += 1) {
    const region = Math.floor(i / 1000) + 1; // @ToDo: calculate actual lot region
    bulkActions.push({
      updateOne: {
        filter: { asteroid: asteroid.i, i },
        update: { asteroid: asteroid.i, i, region },
        upsert: true
      }
    });
  }
  logger.debug('bulkAction count: ', bulkActions.length);
  await mongoose.model('Lot').bulkWrite(bulkActions);
  bulkActions.length = 0;
};

const batches = [
  {
    filter: { i: { $lte: 100 } },
    asyncLimit: 1
  },
  {
    filter: { $and: [{ i: { $gt: 100 } }, { i: { $lt: 300 } }] },
    asyncLimit: 20
  },
  {
    filter: { i: { $gte: 300 } },
    asyncLimit: 100
  }
];

const main = async function () {
  for (const batch of batches) {
    logger.info(`Processing batch: ${JSON.stringify(batch.filter)}...`);
    const cursor = mongoose.model('Asteroid')
      .find(batch.filter)
      .select('i r')
      .sort({ i: 1 })
      .cursor();

    await eachOfLimit(cursor, batch.asyncLimit, createUpdateLots);
    await cursor.close();
  }
};

main()
  .then(done)
  .catch(done);
