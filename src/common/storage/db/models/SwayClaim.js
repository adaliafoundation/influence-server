const mongoose = require('mongoose');
const toJsonPlugin = require('../plugins/toJson');
const { Address } = require('../helpers');

const schema = new mongoose.Schema({
  address: { type: String, set: Address.toStandard, required: true },
  phase: { type: String, required: true },
  amount: { type: Number, required: true },
  proof: { type: [String], required: true },
  claimed: { type: Boolean, default: false }
});

const isClaimed = function () {
  return this.claimed;
};

schema
  .plugin(toJsonPlugin)
  .method('isClaimed', isClaimed)
  .index({
    address: 1,
    phase: 1
  }, { unique: true });

module.exports = mongoose.model('SwayClaim', schema);
