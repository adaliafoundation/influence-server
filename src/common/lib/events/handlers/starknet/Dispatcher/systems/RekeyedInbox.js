const { Address } = require('@influenceth/sdk');
const { uint256: { uint256ToBN } } = require('starknet');
const { ActivityService, UserService } = require('@common/services');
const { hex: { to64: toHex64 } } = require('@common/lib/num');
const logger = require('@common/lib/logger');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x337c10c06d82afee4fc26e619511241cd428c9672b0c8a77b166357f6d72ff0'],
    name: 'RekeyedInbox'
  };

  async processEvent() {
    const { returnValues: { caller, messagingKeyX, messagingKeyY } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({ addresses: [caller], event: this.eventDoc });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: caller });

    try {
      await UserService.updateDirectMessagingKeys({
        address: caller,
        messagingKeys: { x: messagingKeyX, y: messagingKeyY }
      });
    } catch (error) {
      logger.warn(`RekeyedInbox::processEvent: ${error.message}`);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      messagingKeyX: toHex64(uint256ToBN({ low: data.shift(), high: data.shift() })),
      messagingKeyY: toHex64(uint256ToBN({ low: data.shift(), high: data.shift() })),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
