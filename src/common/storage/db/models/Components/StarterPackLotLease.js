const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    permission: { type: Number },
    permitted: { type: EntitySchema, set: EntityHelper.toEntity },
    crew: { type: EntitySchema, set: EntityHelper.toEntity }
  }
], {
  collection: 'Component_StarterPackLotLease',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission', 'permitted.uuid'])
  .index({ 'entity.uuid': 1, permission: 1, 'permitted.uuid': 1 }, { unique: true })
  .index({ 'crew.uuid': 1 });

module.exports = model('StarterPackLotLeaseComponent', schema);
