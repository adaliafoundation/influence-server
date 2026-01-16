const { ComponentService, ElasticSearchService } = require('@common/services');
const { extractInventories } = require('../../utils');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x44656c6976657279'
    ],
    name: 'ComponentUpdated_Delivery'
  };

  async processEvent() {
    const { returnValues: { entity, dest, origin } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Delivery',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (!updated) return;
    await Promise.all([
      ElasticSearchService.queueEntityForIndexing(entity),
      ElasticSearchService.queueEntityForIndexing(origin),
      ElasticSearchService.queueEntityForIndexing(dest)
    ]);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      status: Number(data.shift()),
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      dest: this._entityFromData(data),
      destSlot: Number(data.shift()),
      finishTime: Number(data.shift()),
      contents: extractInventories(data)
    };
  }
}

module.exports = Handler;
