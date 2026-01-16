const { Schema } = require('mongoose');
const { EntityHelper } = require('@common/storage/db/helpers');
const EntitySchema = require('@common/storage/db/schemas/Entity');
const NotificationModel = require('../Notification');

const schema = new Schema({
  crew: { type: EntitySchema, set: EntityHelper.toEntity },
  readyAt: { type: Number }
});

schema
  .index({ 'crew.uuid': 1 }, { unique: true });

module.exports = NotificationModel.discriminator('CrewReadyNotification', schema);
