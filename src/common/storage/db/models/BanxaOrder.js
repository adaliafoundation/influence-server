const mongoose = require('mongoose');
const { Address } = require('../helpers');

const schema = new mongoose.Schema({
  banxaOrderId: { type: String, unique: true, sparse: true },
  externalOrderId: { type: String, unique: true, required: true },
  userAddress: { type: String, set: Address.toStandard, required: true },
  walletAddress: { type: String, set: Address.toStandard, required: true },
  status: {
    type: String,
    enum: ['checkout_created', 'pending', 'completed', 'failed', 'cancelled'],
    default: 'checkout_created'
  },
  fiat: { type: String, required: true },
  fiatAmount: { type: String },
  crypto: { type: String, required: true },
  cryptoAmount: { type: String },
  blockchain: { type: String },
  checkoutUrl: { type: String, required: true },
  rawOrder: { type: mongoose.Schema.Types.Mixed },
  rawWebhookEvents: [{ type: mongoose.Schema.Types.Mixed }]
}, { timestamps: true });

schema
  .index({ userAddress: 1, createdAt: -1 })
  .index({ walletAddress: 1, createdAt: -1 })
  .index({ status: 1 });

module.exports = mongoose.model('BanxaOrder', schema);
