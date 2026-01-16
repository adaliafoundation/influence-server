const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema, InventoryItem } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    contents: [InventoryItem],
    dest: { type: EntitySchema, set: EntityHelper.toEntity },
    destSlot: { type: Number },
    finishTime: { type: Number },
    origin: { type: EntitySchema, set: EntityHelper.toEntity },
    originSlot: { type: Number },
    status: { type: Number }
  }
], {
  collection: 'Component_Delivery',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('DeliveryComponent', schema);
