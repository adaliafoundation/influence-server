const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  blockNumber: { type: Number, required: true },
  blockHash: { type: String, required: true },
  blockTimestamp: { type: Date, required: true },
  forkedAt: { type: Date, required: true },
  label: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('WorldFork', schema);
