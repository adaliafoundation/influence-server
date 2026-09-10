// Preloaded by the production image for API, workers, and operational Node commands.
require('dotenv').config({ silent: true });
const logger = require('./logger');

for (const [method, level] of Object.entries({
  log: 'info', info: 'info', debug: 'debug', warn: 'warn', error: 'error', dir: 'inspect', trace: 'error'
})) {
  console[method] = (...args) => logger[level](...args); // eslint-disable-line no-console
}
process.on('warning', (warning) => logger.warn(warning));
process.on('uncaughtException', (error) => {
  logger.error({ event: 'uncaught_exception', error });
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  logger.error({ event: 'unhandled_rejection', error });
  process.exit(1);
});
