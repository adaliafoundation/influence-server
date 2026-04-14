const { Schema } = require('mongoose');
const { STARKNET: { STATUSES } } = require('@common/constants');
const EventModel = require('../Event');

const schema = new Schema({
  data: { type: Array },
  keys: { type: [String] },
  name: { type: String },
  status: { type: String, enum: STATUSES },
  version: { type: Number, default: 0 }
});

schema
  .index(
    { event: 1, logIndex: 1, transactionHash: 1 },
    {
      name: 'starknet_unique',
      unique: true,
      partialFilterExpression: { removed: false }
    }
  )
  .index(
    {
      event: 1,
      'returnValues.callerCrew.id': 1,
      'returnValues.contentHash': 1,
      'returnValues.transactionHash': 1,
      'returnValues.logIndex': 1,
      'returnValues.caller': 1
    },
    {
      name: 'event_annotation',
      partialFilterExpression: { event: 'EventAnnotated' }
    }
  )
  .index({ status: 1, blockNumber: -1 })
  .index(
    { 'returnValues.idempotencyKey': 1 },
    {
      name: 'idempotency_key_unique',
      unique: true,
      partialFilterExpression: { 'returnValues.idempotencyKey': { $exists: true } }
    }
  );

module.exports = EventModel.discriminator('Starknet', schema);
