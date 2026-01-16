const { Schema, model } = require('mongoose');
const PolicySchema = require('./Policy');

const schema = new Schema([
  PolicySchema, {
    address: { type: String }
  }
], {
  collection: 'Component_ContractPolicy',
  pluginTags: ['useEntitiesPlugin']
});

module.exports = model('ContractPolicyComponent', schema);
