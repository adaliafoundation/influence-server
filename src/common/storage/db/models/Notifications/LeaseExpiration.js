const { Schema } = require('mongoose');
const { EntityHelper } = require('@common/storage/db/helpers');
const EntitySchema = require('@common/storage/db/schemas/Entity');
const NotificationModel = require('../Notification');

const schema = new Schema({
  entity: { type: EntitySchema, set: EntityHelper.toEntity },
  endTime: { type: Number },
  permission: { type: Number },
  permitted: { type: EntitySchema, set: EntityHelper.toEntity }
});

schema
  .index({ 'entity.uuid': 1, permission: 1, 'permitted.uuid': 1 }, { unique: true });

module.exports = NotificationModel.discriminator('LeaseExpirationNotification', schema);
