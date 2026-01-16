const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    controller: { type: EntitySchema, set: EntityHelper.toEntity }
  }
], {
  collection: 'Component_Control',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true })
  .index({ 'controller.uuid': 1, 'entity.label': 1 });

module.exports = model('ControlComponent', schema);
