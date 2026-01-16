const { isNil } = require('lodash');
const { shortString: { decodeShortString } } = require('starknet');

const toBoolean = function (value) {
  if (isNil(value)) return false;
  return (['true', 1, '1', 'yes', 'y'].includes(value.toString().toLowerCase()));
};

const decodeShortStringSafe = function (input) {
  return decodeShortString(BigInt(input).toString(16));
};

const defaultEventSort = (a, b) => ((b.timestamp - a.timestamp) || (b.logIndex - a.logIndex));

module.exports = {
  decodeShortStringSafe,
  defaultEventSort,
  toBoolean
};
