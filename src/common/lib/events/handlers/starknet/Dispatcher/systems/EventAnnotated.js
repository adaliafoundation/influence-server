const { Address } = require('@influenceth/sdk');
const { shortString } = require('starknet');
const { pullAt, range } = require('lodash');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1631635a90f22aec38bc5c520de30e9f5c15aad295280c738b781b7cfea5dd'],
    name: 'EventAnnotated'
  };

  async processEvent() {
    const { returnValues: { caller, callerCrew } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller], entities: [callerCrew], event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      transactionHash: data.shift(),
      logIndex: Number(data.shift()),
      contentHash: pullAt(data, range(0, data.shift())).map(shortString.decodeShortString).join(''),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
