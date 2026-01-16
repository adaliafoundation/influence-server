const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    allowedProducts: [{ type: Number }],
    exchangeType: { type: Number },
    makerFee: { type: Number },
    orders: { type: Number },
    takerFee: { type: Number }
  }
], {
  collection: 'Component_Exchange',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('ExchangeComponent', schema);
