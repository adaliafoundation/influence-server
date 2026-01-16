const { Schema, model } = require('mongoose');
const { EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const AgreementSchema = require('./Agreement');

const schema = new Schema([
  AgreementSchema, {
    permitted: { type: EntitySchema, set: EntityHelper.toEntity },
    whitelisted: { type: Boolean }
  }
], {
  collection: 'Component_WhitelistAgreement',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission', 'permitted.uuid'])
  .index({ 'entity.uuid': 1, permission: 1, 'permitted.uuid': 1 }, { unique: true });

module.exports = model('WhitelistAgreementComponent', schema);
