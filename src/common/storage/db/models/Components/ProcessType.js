const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([ChainComponent, {
  processId: { type: String, required: true },
  definition: { type: Schema.Types.Mixed, required: true }
}], { collection: 'Component_ProcessType' });

schema.plugin(uniquePathPlugin, ['processId']).index({ processId: 1 }, { unique: true });

module.exports = model('ProcessTypeComponent', schema);
