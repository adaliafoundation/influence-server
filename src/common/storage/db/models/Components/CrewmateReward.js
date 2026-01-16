const { Schema, model } = require('mongoose');
const { Component } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  Component, {
    hasSwayClaim: { type: Boolean }
  }
], {
  collection: 'Component_CrewmateReward',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('CrewmateRewardComponent', schema);
