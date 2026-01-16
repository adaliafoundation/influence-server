const { Schema, model } = require('mongoose');
const PolicySchema = require('./Policy');

const schema = new Schema([
  PolicySchema, {
    initialTerm: { type: Number },
    merkleRoot: { type: String },
    merkleTreeIpfsHash: { type: String },
    noticePeriod: { type: Number },
    rate: { type: Number },
    lotIndices: { type: [Number] }
  }
], {
  collection: 'Component_PrepaidMerklePolicy',
  pluginTags: ['useEntitiesPlugin']
});

schema.index({ lotIndices: 1, permission: 1 });

module.exports = model('PrepaidMerklePolicyComponent', schema);
