const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index({
    'event.name': 1,
    'event.returnValues.dryDock.id': 1,
    'event.returnValues.dryDockSlot': 1
  });

module.exports = NotificationModel.discriminator('ShipAssemblyNotification', schema);
