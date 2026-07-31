const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    crew: { type: EntitySchema, set: EntityHelper.toEntity },
    restrictedUntil: { type: Number }
  }
], {
  collection: 'Component_StarterPackBuildingFunding',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true })
  .index({ 'crew.uuid': 1 });

module.exports = model('StarterPackBuildingFundingComponent', schema);
