const { pullAt } = require('lodash');

const { ComponentService, ElasticSearchService } = require('@common/services');
const { Fixed } = require('../../../utils');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x50726f636573736f72'
    ],
    name: 'ComponentUpdated_Processor'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Processor',
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
      slot: Number(data.shift()),
      processorType: Number(data.shift()),
      status: Number(data.shift()),
      runningProcess: Number(data.shift()),
      outputProduct: Number(data.shift()), // the prioritized output product
      recipes: Fixed.toFixed(pullAt(data, 0, 1)).valueOf(), // in number of recipes
      destination: this._entityFromData(data),
      destinationSlot: Number(data.shift()),
      finishTime: Number(data.shift())
    };
  }
}

module.exports = Handler;
