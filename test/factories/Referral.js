const web3 = require('web3');
const { uniqueId } = require('lodash');
const mongoose = require('mongoose');
const Factory = require('./Factory');

class ReferralFactory extends Factory {
  static getModel() {
    return mongoose.model('Referral');
  }

  static async makeOne(options = {}) {
    return new (this.getModel())({
      i: uniqueId(),
      referrer: web3.utils.randomHex(32),
      buyer: web3.utils.randomHex(32),
      ...options
    });
  }
}

module.exports = ReferralFactory;
