const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    destination: { type: EntitySchema, set: EntityHelper.toEntity },
    destinationSlot: { type: Number },
    extractorType: { type: Number },
    finishTime: { type: Number },
    outputProduct: { type: Number },
    slot: { type: Number },
    status: { type: Number },
    yield: { type: Number }
  }
], {
  collection: 'Component_Extractor',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'slot'])
  .index({ 'entity.uuid': 1, slot: 1 }, { unique: true });

module.exports = model('ExtractorComponent', schema);
