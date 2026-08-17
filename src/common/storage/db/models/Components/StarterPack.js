const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent } = require('@common/storage/db/schemas');

const schema = new Schema([
  ChainComponent, {
    productId: { type: Number },
    restrictedUntil: { type: Number },
    valid: { type: Boolean },
    invalidatedAt: { type: Number },
    buildingAllowances: [{
      buildingType: { type: Number },
      count: { type: Number }
    }],
    lotAllowance: { type: Number },
    foodReloadAllowance: { type: Number },
    coreSampleAllowance: { type: Number }
  }
], {
  collection: 'Component_StarterPack',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('StarterPackComponent', schema);
