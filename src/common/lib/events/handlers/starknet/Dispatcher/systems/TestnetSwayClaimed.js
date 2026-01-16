const { Address } = require('@influenceth/sdk');
const { uint256: { uint256ToBN } } = require('starknet');
const { SwayClaimService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1b7e0138e6375e2473a7b58c6f4fb01f63e4e79068ca6b7d7118a1321647ae8'],
    name: 'TestnetSwayClaimed'
  };

  async processEvent() {
    const { returnValues: { caller } } = this.eventDoc;
    await SwayClaimService.claim(caller, 'Testnet 2');
  }

  static transformEventData(event) {
    return {
      amount: Number(uint256ToBN({ low: event.data[0], high: event.data[1] })),
      caller: Address.toStandard(event.data[2], 'starknet')
    };
  }
}

module.exports = Handler;
