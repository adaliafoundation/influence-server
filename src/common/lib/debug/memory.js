const numeral = require('numeral');
const logger = require('../logger');

const usage = function ({ format = '0b' } = {}) {
  const { heapUsed } = process.memoryUsage();
  return (format) ? numeral(heapUsed).format(format) : numeral(heapUsed);
};

const usageMoniter = function ({ interval = 1000 } = {}) {
  return {
    intervalId: null,
    start() {
      this.intervalId = setInterval(() => {
        logger.info(usage({ format: '0b' }));
      }, interval);
      return this;
    },
    stop() {
      clearInterval(this.intervalId);
      return this;
    }
  };
};

module.exports = {
  usage,
  usageMoniter
};
