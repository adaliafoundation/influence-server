const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  entropy: { type: String },
  event: {
    id: { type: 'ObjectId', ref: 'Event' },
    timestamp: { type: Number }
  },
  round: { type: Number }
});

schema
  .index({ round: 1 }, { unique: true });

module.exports = mongoose.model('Entropy', schema);
