const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    abundances: { type: String },
    bonuses: { type: Number },
    celestialType: { type: Number },
    mass: { type: Number },
    purchaseOrder: { type: Number },
    radius: { type: Number },
    scanFinishTime: { type: Number },
    scanStatus: { type: Number }
  }
], {
  collection: 'Component_Celestial',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('CelestialComponent', schema);
