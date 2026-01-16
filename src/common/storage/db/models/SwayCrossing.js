const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { Address, Hex } = require('@common/storage/db/helpers');
const toJsonPlugin = require('../plugins/toJson');

const hasEvent = function ({ transactionHash, logIndex } = {}) {
  if (isNil(transactionHash) || isNil(logIndex)) throw new Error('Missing transactionHash or logIndex');
  const _txhash = Hex.toHex64(transactionHash);
  return this.events.find((event) => event.transactionHash === _txhash && event.logIndex === logIndex);
};

const addEvent = function ({ transactionHash, logIndex, timestamp } = {}) {
  if (isNil(transactionHash) || isNil(logIndex) || isNil(timestamp)) {
    throw new Error('Missing transactionHash, logIndex, or timestamp');
  }
  const _txhash = Hex.toHex64(transactionHash);
  if (this.events.find((event) => event.transactionHash === _txhash && event.logIndex === logIndex)) return this;
  this.events.push({ transactionHash: _txhash, logIndex, timestamp });
  return this;
};

const incrementReadyCount = function () {
  this.readyCount += 1;
  return this;
};

const decrementReadyCount = function () {
  this.readyCount -= 1;
  return this;
};

const incrementPendingCount = function () {
  this.pendingCount += 1;
  return this;
};

const decrementPendingCount = function () {
  this.pendingCount -= 1;
  return this;
};

const schema = new mongoose.Schema([
  {
    amount: { type: String },
    fromAddress: { type: String, set: Address.toStandard },
    events: [
      {
        transactionHash: { type: String, set: Hex.toHex64 },
        logIndex: { type: Number },
        timestamp: { type: Number }
      }
    ],
    pendingCount: { type: Number, default: 0 },
    readyCount: { type: Number, default: 0 },
    toAddress: { type: String, set: Address.toStandard }
  }
]);

schema
  // plugins
  .plugin(toJsonPlugin)

  // methods
  .method('addEvent', addEvent)
  .method('hasEvent', hasEvent)
  .method('incrementReadyCount', incrementReadyCount)
  .method('decrementReadyCount', decrementReadyCount)
  .method('incrementPendingCount', incrementPendingCount)
  .method('decrementPendingCount', decrementPendingCount)

  // indexes
  .index({ toAddress: 1, amount: 1, 'events.transactionHash': 1, 'events.logIndex': 1 });

module.exports = mongoose.model('SwayCrossing', schema);
