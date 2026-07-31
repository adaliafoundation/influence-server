const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');
const { entityFromPathValue, readPath } = require('./starterUtils');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x537461727465725061636b4275696c64696e6746756e64696e67'
    ],
    name: 'ComponentUpdated_StarterPackBuildingFunding'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'StarterPackBuildingFunding',
      event: this.eventDoc,
      data: { ...returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    const [buildingPath] = readPath(data);

    return {
      entity: entityFromPathValue(buildingPath),
      crew: this._entityFromData(data),
      restrictedUntil: Number(data.shift())
    };
  }
}

module.exports = Handler;
