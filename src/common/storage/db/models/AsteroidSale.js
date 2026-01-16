const mongoose = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new mongoose.Schema({
  period: { type: Number, required: true },
  volume: { type: Number, required: true },
  event: {
    id: { type: 'ObjectId', ref: 'Event' },
    timestamp: { type: Number }
  }
});

schema
  .plugin(uniquePathPlugin, ['period'])
  .index({ period: 1 }, { unique: true });

module.exports = mongoose.model('AsteroidSale', schema);
