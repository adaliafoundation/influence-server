const crypto = require('crypto');
const { ec: { starkCurve }, num } = require('starknet');
const bcrypt = require('bcrypt');

const md5 = function (str) {
  return crypto.createHash('md5').update(str).digest('hex');
};

const sha256 = function (str) {
  return crypto.createHash('sha3-256').update(str).digest('hex');
};

const poseidonHashMany = function (value) {
  if (Array.isArray(value) && value.length > 0) {
    return num.toHex(starkCurve.poseidonHashMany(value.map((v) => BigInt(v))));
  }

  throw new Error('Invalid value');
};

const apiKey = {
  generateHash(secret) {
    if (!secret) throw new Error('Invalid secret');
    return bcrypt.hashSync(secret, bcrypt.genSaltSync(8), null);
  }
};

module.exports = {
  apiKey,
  md5,
  poseidonHashMany,
  sha256
};
