const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    name: { type: String }
  }
], {
  collection: 'Component_Name',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ name: 1, 'entity.label': 1 })
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('NameComponent', schema);
