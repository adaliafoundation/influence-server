const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index({
    'event.name': 1,
    'event.returnValues.extractor.id': 1,
    'event.returnValues.extractorSlot': 1,
    'event.returnValues.resource': 1,
    'event.returnValues.destination.id': 1,
    'event.returnValues.destinationSlot': 1
  });

module.exports = NotificationModel.discriminator('ResourceExtractionNotification', schema);
