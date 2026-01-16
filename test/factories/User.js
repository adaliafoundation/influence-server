const web3 = require('web3');
const mongoose = require('mongoose');
const Factory = require('./Factory');

class UserFactory extends Factory {
  static getModel() {
    return mongoose.model('User');
  }

  static async makeOne(options = {}) {
    return new (this.getModel())({
      address: options.address || web3.utils.randomHex(32),
      watchlist: options.watchlist || []
    });
  }
}

module.exports = UserFactory;
