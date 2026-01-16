const { ComponentService, ElasticSearchService } = require('@common/services');
const { extractInventories } = require('../../utils');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x496e76656e746f7279'
    ],
    name: 'ComponentUpdated_Inventory'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Inventory',
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
      inventoryType: Number(data.shift()),
      status: Number(data.shift()),
      mass: Number(data.shift()), // in g
      volume: Number(data.shift()), // in cm^3
      reservedMass: Number(data.shift()), // in g
      reservedVolume: Number(data.shift()), // in cm^3
      contents: extractInventories(data)
    };
  }
}

module.exports = Handler;
