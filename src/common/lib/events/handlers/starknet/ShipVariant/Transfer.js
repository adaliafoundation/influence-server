const { Address } = require('@influenceth/sdk');
const { uint256: { uint256ToBN } } = require('starknet');
// const { NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9'],
    name: 'Transfer'
  };

  async processEvent() {
    throw new Error('This has yet to be implmented');
  }

  static transformEventData(event) {
    return {
      from: Address.toStandard(event.data[0], 'starknet'),
      to: Address.toStandard(event.data[1], 'starknet'),
      tokenId: Number(uint256ToBN({ low: event.data[2], high: event.data[3] }))
    };
  }
}

module.exports = Handler;
