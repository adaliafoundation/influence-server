const mongoose = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: String, required: true },
  event: {
    id: { type: 'ObjectId', ref: 'Event' },
    timestamp: { type: Number }
  }
});

schema
  .plugin(uniquePathPlugin, ['name'])
  .index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Constant', schema);
