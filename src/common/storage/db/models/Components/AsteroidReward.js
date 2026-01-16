const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { Component } = require('@common/storage/db/schemas');

const schema = new Schema([
  Component, {
    hasMintableCrewmate: { type: Boolean },
    hasPrepareForLaunchCrewmate: { type: Boolean },
    hasArrivalStarterPack: { type: Boolean },
    hasSwayClaim: { type: Boolean }
  }
], {
  collection: 'Component_AsteroidReward',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('AsteroidRewardComponent', schema);
