const { isNil, isString } = require('lodash');

const to64 = function (value) {
  if (isString(value) && value.trim() === '') return null;
  return (isNil(value)) ? null : `0x${BigInt(value).toString(16).padStart(64, '0')}`;
};

module.exports = {
  hex: {
    to64
  }
};
