const mongoose = require('mongoose');
const { uniqueId } = require('lodash');
const Factory = require('../Factory');

class StarknetEventFactory extends Factory {
  static getModel() {
    return mongoose.model('Starknet');
  }

  static async makeOne(options = {}) {
    const uid = uniqueId();
    return new (this.getModel())({
      blockHash: `0x${Number(uid).toString(16)}`,
      event: 'TEST_EVENT',
      logIndex: 0,
      transactionHash: `0x${Number(uid).toString(16)}`,
      address: '0x0',
      blockNumber: Number(uid),
      data: [],
      keys: [],
      removed: false,
      returnValues: {},
      transactionIndex: 0,
      timestamp: Date.now(),
      status: 'ACCEPTED_ON_L2',
      ...options
    });
  }
}

module.exports = StarknetEventFactory;
