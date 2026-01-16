require('module-alias/register');
require('dotenv').config({ silent: true });
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const uuid = require('short-uuid');
const { mongoose } = require('@common/storage/db');
const { apiKey } = require('@common/lib/hash');
const logger = require('@common/lib/logger');

const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const main = async function ({ name }) {
  if (!name) throw new Error('Invalid name');
  const key = uuid.uuid();
  const doc = await mongoose.model('ApiKey').create({ name, client_secret: apiKey.generateHash(key) });

  logger.info(`Name: ${doc.name}, Id: ${doc.client_id}, Key: ${key}`);
  process.exit();
};

const args = yargs(hideBin(process.argv))
  .option('name', {
    alias: 'n',
    type: 'string',
    demand: true
  })
  .parse();

main(args)
  .then(done)
  .catch(done);
