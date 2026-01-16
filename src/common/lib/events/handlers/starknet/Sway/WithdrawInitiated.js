const { Address } = require('@influenceth/sdk');
const { uint256: { uint256ToBN }, number: { toHex } } = require('starknet');
const { SwayCrossingService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x282f521c69b2bc696552b9e141009d3c84f2df75e2e7b7716644d31e60f23b1'],
    name: 'WithdrawInitiated'
  };

  async processEvent() {
    const { returnValues: { amount, callerAddress, l1Recipient } } = this.eventDoc;

    await SwayCrossingService.initialize({
      data: {
        amount,
        toAddress: l1Recipient,
        fromAddress: callerAddress
      },
      event: this.eventDoc
    });
  }

  static transformEventData(event) {
    return {
      l1Recipient: Address.toStandard(event.data[0], 'ethereum'),
      amount: toHex(uint256ToBN({ low: event.data[1], high: event.data[2] })),
      callerAddress: Address.toStandard(event.data[3], 'starknet')
    };
  }
}

module.exports = Handler;
