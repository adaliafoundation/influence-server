const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent } = require('@common/storage/db/schemas');

const schema = new Schema([
  ChainComponent, {
    buildingType: { type: Number },
    finishTime: { type: Number },
    status: { type: Number },
    plannedAt: { type: Number }
  }
], {
  collection: 'Component_Building',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true })
  .index({ status: 1 });

module.exports = model('BuildingComponent', schema);
