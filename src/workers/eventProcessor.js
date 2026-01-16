require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
require('@common/storage/db');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const EventProcessor = require('@common/lib/events/processor/EventProcessor');
const logger = require('@common/lib/logger');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const args = yargs(hideBin(process.argv))
  .option('timestamp', {
    alias: 'ts',
    type: 'number',
    description: 'Manually specify a timestamp to start processing from. NOTE, this will override the default filter '
      + 'which is to query for any non-processed events.'
  })
  .help()
  .parse();

const main = async function ({ timestamp }) {
  const runDelay = Number(appConfig.EventProcessor?.runDelay);

  // instatiate retrievers(s)
  const processor = new EventProcessor({ runDelay });

  // run the processor
  await processor.main({ timestamp });
};

main(args)
  .then(done)
  .catch(done);
