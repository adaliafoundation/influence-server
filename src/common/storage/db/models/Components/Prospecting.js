const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const reference = () => ({ type: EntitySchema, set: EntityHelper.toEntity });
const create = (name, fields, keys, entityScoped = false, indexes = []) => {
  const schema = new Schema([ChainComponent, fields], {
    collection: `Component_${name}`, ...(entityScoped ? { pluginTags: ['useEntitiesPlugin'] } : {})
  });
  schema.plugin(uniquePathPlugin, keys).index(Object.fromEntries(keys.map((key) => [key, 1])), { unique: true });
  indexes.forEach((index) => schema.index(index));
  return model(`${name}Component`, schema);
};

module.exports = {
  ClaimComponent: create('Claim', {
    rulesVersion: Number, rateBps: Number, referenceAbundancePpm: Number, campaignId: String
  }, ['entity.uuid'], true),
  ExtractorSlotsComponent: create('ExtractorSlots', { count: Number }, ['entity.uuid'], true),
  ProspectingOriginComponent: create('ProspectingOrigin', { campaignId: String }, ['entity.uuid'], true),
  ProspectingCampaignComponent: create('ProspectingCampaign', {
    campaignId: { type: String, required: true },
    crew: reference(),
    creator: String,
    origin: reference(),
    resource: Number,
    context: String,
    qualityBps: Number,
    verifier: String,
    count: Number,
    pending: Boolean,
    status: Number,
    replaceableAt: Number,
    claim: reference()
  }, ['campaignId'], false, [
    { creator: 1, 'event.timestamp': -1, campaignId: -1 },
    { creator: 1, 'origin.uuid': 1, 'event.timestamp': -1, campaignId: -1 }
  ]),
  ProspectingCoreComponent: create('ProspectingCore', {
    campaignId: { type: String, required: true },
    index: { type: Number, required: true },
    commitment: String,
    meta: String,
    blockedApproaches: Number,
    randomness: String,
    targetBlock: Number,
    readyAt: Number
  }, ['campaignId', 'index'])
};
