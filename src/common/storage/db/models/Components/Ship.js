const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    emergencyAt: { type: Number },
    readyAt: { type: Number },
    shipType: { type: Number },
    status: { type: Number },
    transitArrival: { type: Number },
    transitDeparture: { type: Number },
    transitDestination: { type: EntitySchema, set: EntityHelper.toEntity },
    transitOrigin: { type: EntitySchema, set: EntityHelper.toEntity },
    variant: { type: Number }
  }
], {
  collection: 'Component_Ship',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('ShipComponent', schema);
