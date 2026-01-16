const { Schema } = require('mongoose');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent } = require('@common/storage/db/schemas');

const schema = new Schema([
  ChainComponent, {
    permission: { type: Number }
  }
]);

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission'])
  .index({ 'entity.uuid': 1, permission: 1 }, { unique: true });

module.exports = schema;
