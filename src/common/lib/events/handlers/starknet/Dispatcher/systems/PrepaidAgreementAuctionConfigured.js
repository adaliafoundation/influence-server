const { Address } = require('@influenceth/sdk');
const { ActivityService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xf9af432def51d35770cb49dc1a6b729630cf6ba2bc90013cdeacd67b4da73d'],
    name: 'PrepaidAgreementAuctionConfigured'
  };

  async processEvent() {
    const { asteroid, callerCrew, caller } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ElasticSearchService.queueEntityForIndexing(asteroid);
    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      mode: Number(data.shift()),
      gracePeriod: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
