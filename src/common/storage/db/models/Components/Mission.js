const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

// Mission cells also include campaign/global paths, so no entity hydration is required.
const schema = new Schema([ChainComponent, {
  path: { type: [String], required: true },
  pathKey: { type: String, required: true },
  value: { type: String, required: true },
  namespace: { type: String, required: true },
  campaign: String,
  subjectUuid: String,
  page: Number,
  slot: String,
  slotOrder: String
}], { collection: 'Component_Mission' });

schema.plugin(uniquePathPlugin, ['pathKey'])
  .index({ pathKey: 1 }, { unique: true })
  .index({ campaign: 1, subjectUuid: 1, namespace: 1, slotOrder: 1 });

module.exports = model('MissionComponent', schema);
