const { backOff } = require('exponential-backoff');
const logger = require('@common/lib/logger');

class RpcBackoff {
  static call(fn, {
    delayFirstAttempt = false,
    jitter = 'full',
    label,
    numOfAttempts,
    startingDelay
  } = {}) {
    return backOff(fn, {
      delayFirstAttempt,
      jitter,
      numOfAttempts,
      startingDelay,
      retry(error, attemptNumber) {
        logger.warn(`${label}, retry: ${attemptNumber}`);
        logger.warn(`${label}, operation failed`, error);
        logger.inspect(error, 'debug');
        return true;
      }
    });
  }
}

module.exports = RpcBackoff;
