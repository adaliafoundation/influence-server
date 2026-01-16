const mongoose = require('mongoose');
const { Hex } = require('@common/storage/db/helpers');
const toJsonPlugin = require('../plugins/toJson');

const schema = new mongoose.Schema(
  {
    address: { type: String },
    blockHash: { type: String, required: true },
    blockNumber: { type: Number, required: true, set: Number },
    event: { type: String, required: true },
    ignore: { type: Boolean, default: false },
    logIndex: { type: Number, required: true, set: Number },
    removed: { type: Boolean, default: false },
    returnValues: { type: Object },
    lastProcessed: { type: Date },
    signature: { type: String },
    timestamp: { type: Number, required: true, set: Number },
    transactionHash: { type: String, required: true, set: Hex.toHex64 },
    transactionIndex: { type: Number, set: Number }
  },
  { discriminatorKey: '__t', timestamps: true }
);

const preValidate = function () {
  // ensure standardization
  if (this.transactionHash) this.set('transactionHash', this.transactionHash);
};

const preFind = function () {
  // filter out igrnored documents
  this.where({ ignore: { $ne: true } });
};

const getSourceType = function () {
  return this.get('__t');
};

const isEthereumEvent = function () {
  return this.getSourceType() === 'Ethereum';
};

const isStarknetEvent = function () {
  return this.getSourceType() === 'Starknet';
};

schema
  .plugin(toJsonPlugin)
  .method('isEthereumEvent', isEthereumEvent)
  .method('isStarknetEvent', isStarknetEvent)
  .method('getSourceType', getSourceType)
  // middleware
  .pre('validate', preValidate)
  .pre('find', preFind)
  // Indices
  .index({ blockHash: 1, event: 1, logIndex: 1, transactionHash: 1 })
  .index({ lastProcessed: 1, timestamp: -1 })
  .index({ __t: 1, blockNumber: -1 })
  .index({ transactionHash: 1, logIndex: 1 });

module.exports = mongoose.model('Event', schema);
