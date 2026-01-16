const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index({ 'event.name': 1, 'event.returnValues.processor.id': 1, 'event.returnValues.processorSlot': 1 });

module.exports = NotificationModel.discriminator('MaterialProcessingNotification', schema);
