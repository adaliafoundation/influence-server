const { Schema, model } = require('mongoose');
const { EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const AgreementSchema = require('./Agreement');

const updateToCancelled = function () {
  this.set('status', 'CANCELLED');
  return this.save();
};

const updateToTransferred = function () {
  this.set('status', 'TRANSFERRED');
  return this.save();
};

const resetStatus = function () {
  this.set('status', undefined);
  return this.save();
};

const schema = new Schema([
  AgreementSchema, {
    permitted: { type: EntitySchema, set: EntityHelper.toEntity },
    endTime: { type: Number },
    initialTerm: { type: Number },
    noticePeriod: { type: Number },
    noticeTime: { type: Number },
    rate: { type: Number },
    startTime: { type: Number },
    status: { type: String, enum: ['CANCELLED', 'TRANSFERRED'] }
  }
], {
  collection: 'Component_PrepaidAgreement',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid', 'permission', 'permitted.uuid'])
  .index({ 'entity.uuid': 1, permission: 1, 'permitted.uuid': 1 }, { unique: true })
  .index({ endTime: 1 })
  .method('resetStatus', resetStatus)
  .method('updateToCancelled', updateToCancelled)
  .method('updateToTransferred', updateToTransferred);

module.exports = model('PrepaidAgreementComponent', schema);
