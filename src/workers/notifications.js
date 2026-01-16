require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
require('@common/storage/db');
const logger = require('@common/lib/logger');
const NotificationsProcessor = require('@common/lib/notifications/Processor');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  // Check if notifications are enabled in the environment
  if (!Number(appConfig.get('Notifications.email.enabled'))) {
    done('Notifcations are currently disabled');
  }

  const processor = new NotificationsProcessor();
  await processor.process();
};

main().then(done).catch(done);
