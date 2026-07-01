const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x5072657061696441677265656d656e7441756374696f6e536574'
    ],
    name: 'ComponentUpdated_PrepaidAgreementAuctionSet'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'PrepaidAgreementAuctionSet',
      event: this.eventDoc,
      data: returnValues,
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      mode: Number(data.shift()),
      gracePeriod: Number(data.shift())
    };
  }
}

module.exports = Handler;
