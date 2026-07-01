const { Address } = require('@influenceth/sdk');
const { ActivityService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x334fe37225fde1407e1a0399f7309e816eb531d659a0318321916ce64d39894'],
    name: 'PrepaidAgreementAuctionCancelled'
  };

  async processEvent() {
    const { lot, callerCrew, caller } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [lot, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ElasticSearchService.queueEntityForIndexing(lot);
    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      lot: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
