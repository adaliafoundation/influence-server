const mongoose = require('mongoose');
const Component = require('./Component');
const { toJsonPlugin } = require('../plugins');

const schema = new mongoose.Schema([
  Component, {
    event: {
      id: { type: 'ObjectId', ref: 'Event' },
      timestamp: { type: Number }
    }
  }
]);

schema.virtual('virtuals.event', {
  foreignField: '_id',
  justOne: true,
  localField: 'event.id',
  ref: 'Event'
});

schema
  .plugin(toJsonPlugin, { omit: ['_id', 'id'] });

module.exports = schema;
