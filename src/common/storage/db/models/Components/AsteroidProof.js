const { Schema, model } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { Component } = require('@common/storage/db/schemas');

const schema = new Schema([
  Component, {
    proof: [{ type: String }],
    used: { type: Boolean, default: false }
  }
], {
  collection: 'Component_AsteroidProof',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('AsteroidProofComponent', schema);
