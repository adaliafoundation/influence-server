require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
const { Timer } = require('timer-node');
const { delay } = require('lodash');
require('@common/storage/db');
const logger = require('@common/lib/logger');
const { NftComponentService } = require('@common/services');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  const keepRunning = true;
  const logSlug = 'NFTCardBuilder';
  const runDelay = appConfig.get('NftCardBuilder.runDelay');

  while (keepRunning) {
    const timer = new Timer({ label: 'NFTCardBuilder-timer' }).start();

    await NftComponentService.updateCards();

    if (timer.ms() <= runDelay) {
      const delayMs = runDelay - timer.ms();
      logger.info(`${logSlug}, run delay not met, delaying for [${delayMs}ms]...`);
      await new Promise((resolve) => {
        delay(resolve, delayMs);
      });
    }
  }
};

main()
  .then(done)
  .catch(done);
