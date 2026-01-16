const appConfig = require('config');
const Keyv = require('keyv');
const logger = require('../logger');

let keyv;

if (appConfig.util.getEnv('NODE_ENV') === 'test') {
  keyv = new Keyv();
} else {
  keyv = new Keyv(appConfig.get('MongoDb.uri'));
}

// Handle connection errors
keyv.on('error', (error) => logger.error(`MongoCache::connectionError, ${error.message || error}`));

module.exports = keyv;
