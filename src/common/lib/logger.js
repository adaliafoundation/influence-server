const appConfig = require('config');
const { createLogger, transports, format } = require('winston');
const { SECRET_PATHS } = require('./secretFiles');
const { createRedactor } = require('./logRedaction');

const redact = createRedactor(Object.values(SECRET_PATHS)
  .filter((path) => appConfig.has(path)).map((path) => appConfig.get(path)));
const json = appConfig.get('App.logFormat') === 'json';
const log = createLogger({
  format: format.combine(
    format.timestamp(),
    json ? format.json() : format.combine(format.colorize(), format.simple())
  ),
  level: appConfig.App.logLevel || 'warn',
  transports: [new transports.Console()]
});

function write(level, message, ...details) {
  const fields = typeof message === 'string' ? { message } : { message: 'application', detail: message };
  if (details.length) fields.details = details;
  log.log({ ...redact(fields), level });
}

module.exports = {
  debug: (...args) => write('debug', ...args),
  error: (...args) => write('error', ...args),
  info: (...args) => write('info', ...args),
  inspect: (value, level = 'debug') => write(level, value),
  verbose: (...args) => write('verbose', ...args),
  warn: (...args) => write('warn', ...args)
};
