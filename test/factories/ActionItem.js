const { random } = require('lodash');
const mongoose = require('mongoose');
const Factory = require('./Factory');

class ActionItemFactory extends Factory {
  static getModel() {
    return mongoose.model('ActionItem');
  }

  static async makeOne(options = {}) {
    return new (this.getModel())({
      event: {
        logIndex: options.event?.logIndex || random(1, 100),
        name: options.event?.name || 'TEST_EVENT',
        transactionIndex: options.event?.transactionIndex || random(1, 100),
        transactionHash: options.event?.transactionHash || random(1, 100)
      },
      owner: options.owner || random(1, 100),
      ownerType: options.ownerType || 'Asteroid',
      key: options.key || random(1, 100)
    });
  }
}

module.exports = ActionItemFactory;
