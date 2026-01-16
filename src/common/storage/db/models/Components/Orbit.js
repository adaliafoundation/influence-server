const { Schema, model } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');

const schema = new Schema([
  ChainComponent, {
    a: { type: Number }, // a
    ecc: { type: Number }, // e
    inc: { type: Number }, // i
    raan: { type: Number }, // o
    argp: { type: Number }, // w
    m: { type: Number } // m
  }
], {
  collection: 'Component_Orbit',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('OrbitComponent', schema);
