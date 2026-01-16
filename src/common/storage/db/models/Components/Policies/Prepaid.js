const { Schema, model } = require('mongoose');
const PolicySchema = require('./Policy');

const schema = new Schema([
  PolicySchema, {
    initialTerm: { type: Number },
    noticePeriod: { type: Number },
    rate: { type: Number }
  }
], {
  collection: 'Component_PrepaidPolicy',
  pluginTags: ['useEntitiesPlugin']
});

module.exports = model('PrepaidPolicyComponent', schema);
