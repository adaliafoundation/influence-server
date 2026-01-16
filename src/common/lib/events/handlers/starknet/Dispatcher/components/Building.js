const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4275696c64696e67'
    ],
    name: 'ComponentUpdated_Building'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Building',
      event: this.eventDoc,
      data: { ...returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      status: Number(data.shift()),
      buildingType: Number(data.shift()),
      plannedAt: Number(data.shift()),
      finishTime: Number(data.shift())
    };
  }
}

module.exports = Handler;
