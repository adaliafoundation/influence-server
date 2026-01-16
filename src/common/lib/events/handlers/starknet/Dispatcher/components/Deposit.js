const { pullAt } = require('lodash');

const { ComponentService, ElasticSearchService } = require('@common/services');
const { Fixed } = require('../../utils');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4465706f736974'
    ],
    name: 'ComponentUpdated_Deposit'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Deposit',
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
      status: Number(data.shift()),
      resource: Number(data.shift()),
      initialYield: Number(data.shift()),
      remainingYield: Number(data.shift()),
      finishTime: Number(data.shift()),
      yieldEff: Fixed.toFixed(pullAt(data, 0, 1)).valueOf()
    };
  }
}

module.exports = Handler;
