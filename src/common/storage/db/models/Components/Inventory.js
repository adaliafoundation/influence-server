const { Schema, model } = require('mongoose');
const { ChainComponent, InventoryItem } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    contents: [{ type: InventoryItem }],
    inventoryType: { type: Number },
    mass: { type: Number },
    slot: { type: Number },
    status: { type: Number },
    reservedMass: { type: Number },
    reservedVolume: { type: Number },
    volume: { type: Number }
  }
], {
  collection: 'Component_Inventory',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'slot'])
  .index({ 'entity.uuid': 1, slot: 1 }, { unique: true });

module.exports = model('InventoryComponent', schema);
