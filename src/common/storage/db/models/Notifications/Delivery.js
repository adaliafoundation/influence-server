const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index({ 'event.name': 1, 'event.returnValues.delivery.id': 1 });

module.exports = NotificationModel.discriminator('DeliveryNotification', schema);
