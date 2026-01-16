const { Address } = require('@influenceth/sdk');

const toStandard = function (address, chain) {
  return (address) ? Address.toStandard(address, chain) : null;
};

module.exports = {
  toStandard
};
