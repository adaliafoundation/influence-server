const mongoose = require('mongoose');
const { random } = require('lodash');
const Factory = require('../Factory');

class NftFactory extends Factory {
  static getModel() {
    return mongoose.model('NftComponent');
  }

  static async makeOne(options = {}) {
    return new (this.getModel())({
      entity: {
        id: random(1, 250_000),
        label: 3
      },
      ...options
    });
  }
}

module.exports = NftFactory;
