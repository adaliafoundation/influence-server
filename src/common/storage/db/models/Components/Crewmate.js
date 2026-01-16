const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    appearance: { type: String },
    class: { type: Number },
    coll: { type: Number },
    cosmetic: [{ type: Number }],
    impactful: [{ type: Number }],
    title: { type: Number },
    status: { type: Number }
  }
], {
  collection: 'Component_Crewmate',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('CrewmateComponent', schema);
