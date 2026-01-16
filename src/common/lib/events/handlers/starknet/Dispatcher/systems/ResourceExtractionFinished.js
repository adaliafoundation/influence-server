const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys } = require('./ResourceExtractionStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3b79c1330b2be99d66b412f90e606ac683ff72acd4715551f21d2e97f53e6c7'],
    name: 'ResourceExtractionFinished'
  };

  async processEvent() {
    const { returnValues: { caller, callerCrew, extractor, destination } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [extractor, destination, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('ResourceExtractionStarted', this.eventDoc, hashKeys);

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      extractor: this._entityFromData(data),
      extractorSlot: Number(data.shift()),
      resource: Number(data.shift()),
      yield: Number(data.shift()),
      destination: this._entityFromData(data),
      destinationSlot: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
