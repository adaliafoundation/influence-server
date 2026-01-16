const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    amount: { type: Number },
    status: { type: Number }
  }
], {
  collection: 'Component_PrivateSale',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('PrivateSaleComponent', schema);
