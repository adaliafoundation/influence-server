const mongoose = require('mongoose');
const { Address, Hex } = require('../helpers');
const toJsonPlugin = require('../plugins/toJson');

const schema = new mongoose.Schema({
  address: { type: String, set: Address.toStandard, required: true },
  annotated: {
    transactionHash: { type: String, required: true, set: Hex.toHex64 },
    logIndex: { type: Number, required: true }
  },
  crew: { type: Number, required: true },
  ipfs: {
    service: { type: String, enum: ['infura'] },
    hash: { type: String },
    pinned: { type: Boolean }
  }
}, { timestamps: true });

const preValidate = function () {
  // ensure standardization
  if (this.transactionHash) this.set('transactionHash', this.transactionHash);
};

const isPinned = function () {
  return this.ipfs.pinned;
};

schema
  .plugin(toJsonPlugin)
  .method('isPinned', isPinned)
  .pre('validate', preValidate)
  .index({
    address: 1,
    crew: 1,
    'ipfs.hash': 1,
    'annotated.transactionHash': 1,
    'annotated.logIndex': 1
  }, { unique: true });

module.exports = mongoose.model('EventAnnotation', schema);
