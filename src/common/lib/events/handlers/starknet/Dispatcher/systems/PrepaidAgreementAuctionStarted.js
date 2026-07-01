const { Address } = require('@influenceth/sdk');
const { ActivityService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2523d7518fa6280f97d7719fb9662dca9e53994434fc3b5a147eaa50486f99'],
    name: 'PrepaidAgreementAuctionStarted'
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
      startTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
