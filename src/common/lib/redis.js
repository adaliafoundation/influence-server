const appConfig = require('config');
const Keyv = require('keyv');
const logger = require('./logger');

let keyv;
const REDIS_URL = appConfig.Redis?.uri;
const NODE_ENV = appConfig.util.getEnv('NODE_ENV');

if (REDIS_URL && NODE_ENV !== 'test') {
  const options = (NODE_ENV !== 'development') ? { tls: { rejectUnauthorized: false } } : {};
  keyv = new Keyv(REDIS_URL, options);
} else {
  keyv = new Keyv();
}

// Handle connection errors
keyv.on('error', (err) => logger.error('Cache::connectionError', err));

module.exports = keyv;
