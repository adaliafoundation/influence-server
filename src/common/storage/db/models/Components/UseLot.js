const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    tenant: { type: EntitySchema, set: (value) => (value === null ? null : EntityHelper.toEntity(value)) }
  }
], {
  collection: 'Component_UseLot',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

// Preserve explicit clearing; the shared serializer otherwise omits null fields.
const jsonOptions = schema.get('toJSON');
schema.set('toJSON', {
  ...jsonOptions,
  transform: (doc, ret) => ({ ...jsonOptions.transform(doc, ret), tenant: ret.tenant ?? null })
});

module.exports = model('UseLotComponent', schema);
