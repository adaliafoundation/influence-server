const mongoose = require('mongoose');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const toJsonPlugin = require('../plugins/toJson');
const { Address } = require('../helpers');

const getAssetIdsKey = function () {
  return `${this.assetType}:${this.assetIds.join('_')}`;
};

const schema = new mongoose.Schema(
  {
    assetIds: { type: [Number] },
    assetIdsKey: { type: String, default: getAssetIdsKey }, // concatenated string used as key
    assetType: { type: String, enum: ['Asteroid', 'Crew', 'Crewmate', 'Ship'] },
    destination: {
      type: String,
      enum: [CHAINS.ETHEREUM, CHAINS.STARKNET]
    },
    destinationBridge: { type: String, set: Address.toStandard }, // bridge address
    fromAddress: { type: String, set: Address.toStandard },
    origin: {
      type: String,
      enum: [CHAINS.ETHEREUM, CHAINS.STARKNET]
    },
    originBridge: { type: String, set: Address.toStandard }, // bridge address
    status: {
      type: String,
      enum: [BRIDGING_STATES.PROCESSING, BRIDGING_STATES.COMPLETE]
    },
    toAddress: { type: String, set: Address.toStandard }
  }
);

schema
  .plugin(toJsonPlugin)
  .index({ assetIdsKey: 1 }, { unique: true })
  .index({ fromAddress: 1 })
  .index({ toAddress: 1 });

module.exports = mongoose.model('Crossing', schema);
