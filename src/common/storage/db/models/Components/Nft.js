const { Schema, model } = require('mongoose');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { ChainComponent } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { Address } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    bridge: {
      destination: {
        type: String,
        enum: [CHAINS.ETHEREUM, CHAINS.STARKNET]
      },
      origin: {
        type: String,
        enum: [CHAINS.ETHEREUM, CHAINS.STARKNET]
      },
      status: {
        type: String,
        enum: [BRIDGING_STATES.PROCESSING, BRIDGING_STATES.COMPLETE]
      }
    },
    owners: {
      ethereum: { type: String, set: (address) => Address.toStandard(address, 'ethereum') },
      starknet: { type: String, set: (address) => Address.toStandard(address, 'starknet') }
    },
    price: { type: Number },
    updateImage: {
      type: Boolean,
      default: false
    }
  }
], {
  collection: 'Component_Nft',
  pluginTags: ['useEntitiesPlugin']
});

schema.virtual('owner').get(function () {
  if (Number(this.owners.ethereum) > 0) return this.owners.ethereum;
  if (Number(this.owners.starknet) > 0) return this.owners.starknet;
  return null;
});

schema.virtual('chain').get(function () {
  if (this.bridge.status === BRIDGING_STATES.COMPLETE) return this.bridge.destination;
  if (this.bridge.starknet === BRIDGING_STATES.PROCESSING) return this.bridge.origin;
  if (this.owners.ethereum) return CHAINS.ETHEREUM;
  if (this.owners.starknet) return CHAINS.STARKNET;
  return null;
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .index({ updateImage: 1 })
  .index({ 'owners.starknet': 1, 'entity.label': 1 })
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('NftComponent', schema);
