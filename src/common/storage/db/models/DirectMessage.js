const mongoose = require('mongoose');
const { Address, Hex } = require('../helpers');
const toJsonPlugin = require('../plugins/toJson');

const schema = new mongoose.Schema({
  // TODO: include public key so we know if decryptable?
  event: {
    logIndex: { type: Number },
    timestamp: { type: Number },
    transactionHash: { type: String, set: Hex.toHex64 },
    transactionIndex: { type: Number }
  },
  ipfs: {
    service: { type: String, enum: ['infura'] },
    hash: { type: String },
    pinned: { type: Boolean }
  },
  read: { type: Boolean, default: false },
  recipient: { type: String, set: Address.toStandard, required: true },
  sender: { type: String, set: Address.toStandard, required: true }
}, { timestamps: true });

const isPinned = function () {
  return this.ipfs.pinned;
};

schema
  .plugin(toJsonPlugin)
  .method('isPinned', isPinned)
  .index({ recipient: 1 })
  .index({ sender: 1 })
  .index({
    sender: 1,
    recipient: 1,
    'ipfs.hash': 1,
    'event.transactionHash': 1,
    'event.logIndex': 1
  }, { unique: true });

module.exports = mongoose.model('DirectMessage', schema);
