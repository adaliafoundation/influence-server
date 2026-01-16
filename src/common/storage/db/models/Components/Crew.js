const { Schema, model } = require('mongoose');
const { Address } = require('@influenceth/sdk');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    actionRound: { type: Number },
    actionStrategy: { type: Number },
    actionTarget: { type: EntitySchema, set: EntityHelper.toEntity },
    actionType: { type: Number },
    actionWeight: { type: Number },
    delegatedTo: { type: String, set: Address.toStandard },
    lastFed: { type: Number },
    lastReadyAt: { type: Number },
    readyAt: { type: Number },
    roster: [{ type: Number }]
  }
], {
  collection: 'Component_Crew',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ delegatedTo: 1, 'entity.label': 1 })
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('CrewComponent', schema);
