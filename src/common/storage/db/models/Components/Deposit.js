const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    finishTime: { type: Number },
    initialYield: { type: Number },
    remainingYield: { type: Number },
    resource: { type: Number },
    status: { type: Number },
    yieldEff: { type: Number }
  }
], {
  collection: 'Component_Deposit',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('DepositComponent', schema);
