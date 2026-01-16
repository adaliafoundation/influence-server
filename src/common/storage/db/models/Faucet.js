const mongoose = require('mongoose');
const { Address } = require('../helpers');

const faucetSchema = new mongoose.Schema({
  recipient: { type: String, required: true }, // Address
  token: { type: String, required: true }, // Type of token (ETH or SWAY)
  lastClaimed: { type: Date, default: null },
  totalClaimed: { type: Number, default: 0 }
});

const preSave = function () {
  // Standardize addresses
  if (this.recipient && this.recipient !== null) {
    this.recipient = Address.toStandard(this.recipient);
  }
};

faucetSchema
  .pre('save', preSave)
  .index({ recipient: 1, token: 1 });

module.exports = mongoose.model('Faucet', faucetSchema);
