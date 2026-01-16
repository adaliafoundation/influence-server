const { pullAt, range } = require('lodash');

const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x45786368616e6765'
    ],
    name: 'ComponentUpdated_Exchange'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Exchange',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      exchangeType: Number(data.shift()),
      makerFee: Number(data.shift()),
      takerFee: Number(data.shift()),
      orders: Number(data.shift()),
      allowedProducts: pullAt(data, range(0, Number(data.shift()))).map(Number)
    };
  }
}

module.exports = Handler;
