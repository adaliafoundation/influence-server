const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys: hashKeysV0 } = require('./MaterialProcessingStarted/v0');
const { hashKeys: hashKeysV1 } = require('./MaterialProcessingStarted/v1');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x17d3031632aeed96ab9d68226d6439ef5fdc0bb7f8086a7cc6a54207da53e4'],
    name: 'MaterialProcessingFinished'
  };

  async processEvent() {
    const { returnValues: { processor, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [processor, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys
    });

    if (activityResult?.created === 0) return;

    const { status } = await ActivityService.resolveStartActivity(
      'MaterialProcessingStarted',
      this.eventDoc,
      hashKeysV0
    );
    if (status === 'NOT_FOUND') {
      await ActivityService.resolveStartActivity('MaterialProcessingStarted', this.eventDoc, hashKeysV1);
    }

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      processor: this._entityFromData(data),
      processorSlot: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
