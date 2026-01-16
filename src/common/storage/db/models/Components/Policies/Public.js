const { Schema, model } = require('mongoose');
const PolicySchema = require('./Policy');

const schema = new Schema([
  PolicySchema, {
    public: { type: Boolean }
  }
], {
  collection: 'Component_PublicPolicy',
  pluginTags: ['useEntitiesPlugin']
});

module.exports = model('PublicPolicyComponent', schema);
