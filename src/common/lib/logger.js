const appConfig = require('config');
const { inspect } = require('util');
const { createLogger, transports, format } = require('winston');

const DEFAULT_LOG_LEVEL = 'warn';

const log = createLogger({
  format: format.combine(
    format.colorize(),
    format.simple()
  ),
  level: appConfig.App.logLevel || DEFAULT_LOG_LEVEL,
  transports: [new transports.Console()]
});

class logger {
  static debug(args) {
    log.debug(args);
  }

  static error(args) {
    log.error(args);
  }

  static info(args) {
    log.info(args);
  }

  static inspect(args, level = 'debug') {
    log[level](inspect(args, { depth: null }));
  }

  static verbose(args) {
    log.verbose(args);
  }

  static warn(args) {
    log.warn(args);
  }
}

module.exports = logger;
