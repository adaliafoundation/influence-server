const { Schema } = require('mongoose');
const ResolvableEventSchema = require('./schemas/ResolvableEvent');
const NotificationModel = require('../Notification');

const schema = new Schema([ResolvableEventSchema]);

schema
  .index(
    { 'event.name': 1, 'event.returnValues.asteroid.id': 1 },
    { name: 'SurfaceScanNotification_event.name_1_event.returnValues.asteroid.id_1' }
  );

module.exports = NotificationModel.discriminator('SurfaceScanNotification', schema);
