const { backOff } = require('exponential-backoff');
const { defaults } = require('lodash');
const logger = require('../../logger');

class DefaultStarknetProvider {
  get defaultBackoffOptions() {
    return { numOfAttempts: 10, startingDelay: 20 };
  }

  constructor({ backoffOpts, ...props } = {}) {
    this.endpoint = props.endpoint;
    this._backoffOptions = defaults(
      {},
      backoffOpts,
      this.defaultBackoffOptions
    );
  }

  _callWithBackoff(fn, fnName) {
    return backOff(fn, {
      delayFirstAttempt: true,
      jitter: 'full',
      numOfAttempts: this._backoffOptions.numOfAttempts,
      startingDelay: this._backoffOptions.startingDelay,
      retry(error, attemptNumber) {
        logger.warn(`${fnName}, retry: ${attemptNumber}`);
        logger.warn(`${fnName}, error: ${error.message || error}`);
        logger.inspect(error, 'debug');
        return true;
      }
    });
  }
}

module.exports = DefaultStarknetProvider;
