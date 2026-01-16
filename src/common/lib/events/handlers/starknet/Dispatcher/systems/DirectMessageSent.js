const { Address } = require('@influenceth/sdk');
const { shortString } = require('starknet');
const { pullAt, range } = require('lodash');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x14a843a15066cfcf979b84e5c90ddc2c93bdc60d08334b06416eb253c7b3023'],
    name: 'DirectMessageSent'
  };

  async processEvent() {
    const { returnValues: { caller, recipient } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller, recipient], event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: caller });
    this.messages.push({ to: recipient });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      recipient: Address.toStandard(data.shift(), 'starknet'),
      contentHash: pullAt(data, range(0, data.shift())).map(shortString.decodeShortString).join(''),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
