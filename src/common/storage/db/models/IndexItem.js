const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  model: { type: String },
  identifier: { type: 'mixed' },
  priority: { type: Number, default: 0 } // lower number is lower priority
}, { timestamps: true });

schema
  .index({ priority: -1, createdAt: -1 });

module.exports = mongoose.model('IndexItem', schema);
