const mongoose = require('mongoose');
const { EntitySchema } = require('@common/storage/db/schemas');
const { Address, EntityHelper } = require('@common/storage/db/helpers');
const toJsonPlugin = require('@common/storage/db/plugins/toJson');

const schema = new mongoose.Schema(
  {
    recipients: {
      addresses: [{ type: String, set: Address.toStandard }],
      entities: [{ type: EntitySchema, set: EntityHelper.toEntity }]
    },
    notifyOn: { type: Date }
  },
  { discriminatorKey: '__t', timestamps: true }
);

schema
  .index({ notifyOn: 1 })
  // Resolvable event notifications are unique by event
  .index(
    { 'event.transactionHash': 1, 'event.logIndex': 1 },
    { unique: true, sparse: true, name: 'ResolvableEventNotification_event.transactionHash_1_event.logIndex_1' }
  )
  .plugin(toJsonPlugin, { omit: ['_id'] });

module.exports = mongoose.model('Notification', schema);
