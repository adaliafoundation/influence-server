require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
require('@common/storage/db');
const { StarknetRetriever } = require('@common/lib/events/retrievers/starknet/retriever');
const logger = require('@common/lib/logger');
const { isHybrid } = require('@common/lib/gameMode');

// Auditor disabled in hybrid mode (no dispatcher events to audit)
if (isHybrid()) {
  logger.info('Starknet event auditor disabled in hybrid mode');
  process.exit(0);
}

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  const retriever = new StarknetRetriever();

  try {
    await retriever.auditRunner({
      runDelay: appConfig.get('EventRetriever.starknet.auditRunDelay'),
      blockOffset: appConfig.get('EventRetriever.starknet.auditBlockOffset')
    });
  } catch (error) {
    logger.inspect(error, 'error');
  }
};

main()
  .then(done)
  .catch(done);
