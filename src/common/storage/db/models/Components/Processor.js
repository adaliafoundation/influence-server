const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    destination: { type: EntitySchema, set: EntityHelper.toEntity },
    destinationSlot: { type: Number },
    finishTime: { type: Number },
    outputProduct: { type: Number },
    processorType: { type: Number },
    recipes: { type: Number },
    runningProcess: { type: Number },
    secondaryEff: { type: Number },
    slot: { type: Number },
    status: { type: Number }
  }
], {
  collection: 'Component_Processor',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'slot'])
  .index({ 'entity.uuid': 1, slot: 1 }, { unique: true });

module.exports = model('ProcessorComponent', schema);
