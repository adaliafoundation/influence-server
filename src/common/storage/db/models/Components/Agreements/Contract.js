const { Schema, model } = require('mongoose');
const { EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const AgreementSchema = require('./Agreement');

const schema = new Schema([
  AgreementSchema, {
    address: { type: String },
    permitted: { type: EntitySchema, set: EntityHelper.toEntity }
  }
], {
  collection: 'Component_ContractAgreement',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission', 'permitted.uuid'])
  .index({ 'entity.uuid': 1, permission: 1, 'permitted.uuid': 1 }, { unique: true });

module.exports = model('ContractAgreementComponent', schema);
