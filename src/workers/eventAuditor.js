require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');
const { CombinedEventAuditor } = require('@common/lib/events/auditors');
const logger = require('@common/lib/logger');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  const auditor = new CombinedEventAuditor();

  try {
    await auditor.runOnce();
  } catch (error) {
    logger.inspect(error, 'error');
  }
};

main()
  .then(done)
  .catch(done);
