const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');

class SwayClaimService {
  static findByAddress(address) {
    return mongoose.model('SwayClaim').find({ address });
  }

  static updateOrCreateOne(data) {
    return mongoose.model('SwayClaim').updateOne(
      { address: data.address, phase: data.phase },
      data,
      { upsert: true }
    );
  }

  static claim(address, phase) {
    return mongoose.model('SwayClaim').updateOne(
      { address: Address.toStandard(address), phase },
      { claimed: true }
    );
  }
}

module.exports = SwayClaimService;
