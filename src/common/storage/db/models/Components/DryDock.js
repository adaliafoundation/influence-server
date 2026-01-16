const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    dryDockType: { type: Number },
    finishTime: { type: Number },
    outputShip: { type: EntitySchema, set: EntityHelper.toEntity },
    slot: { type: Number },
    status: { type: Number }
  }
], {
  collection: 'Component_DryDock',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('DryDockComponent', schema);
