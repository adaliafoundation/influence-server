const mongoose = require('mongoose');
const { Address } = require('../helpers');

const schema = new mongoose.Schema({
  userAddress: { type: String, set: Address.toStandard, required: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'StarterPackPurchase', required: true },
  chainId: { type: String, required: true },
  method: { type: String, required: true },
  transactionType: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  preparedFingerprint: { type: String, required: true },
  estimatedFeeFri: { type: String, required: true },
  reservedMilliStrk: { type: Number, required: true },
  status: {
    type: String,
    enum: ['reserved', 'submitted'],
    default: 'reserved'
  },
  txHash: { type: String }
}, { timestamps: true });

schema
  .index({ purchase: 1, status: 1 })
  .index({ preparedFingerprint: 1, status: 1 })
  .index({ requestFingerprint: 1 }, { unique: true });

module.exports = mongoose.model('PaymasterSponsorship', schema);
