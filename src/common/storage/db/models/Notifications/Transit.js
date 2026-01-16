const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index({
    'event.name': 1,
    'event.returnValues.ship.id': 1,
    'event.returnValues.origin.label': 1,
    'event.returnValues.origin.id': 1,
    'event.returnValues.destination.label': 1,
    'event.returnValues.destination.id': 1,
    'event.returnValues.departure': 1,
    'event.returnValues.arrival': 1
  });

module.exports = NotificationModel.discriminator('TransitNotification', schema);
