const { Schema, model } = require('mongoose');
const { Address } = require('@common/storage/db/helpers');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const AgreementSchema = require('./Agreement');

const schema = new Schema([
  AgreementSchema, {
    permitted: { type: String, set: Address.toStandard },
    whitelisted: { type: Boolean }
  }
], {
  collection: 'Component_WhitelistAccountAgreement',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission', 'permitted'])
  .index({ 'entity.uuid': 1, permission: 1, permitted: 1 }, { unique: true });

module.exports = model('WhitelistAccountAgreementComponent', schema);
