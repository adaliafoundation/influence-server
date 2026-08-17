const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');
const { entityFromPathValue, readPath } = require('./starterUtils');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x537461727465725061636b'
    ],
    name: 'ComponentUpdated_StarterPack'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'StarterPack',
      event: this.eventDoc,
      data: { ...returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    const [crewPath] = readPath(data);
    const buildingAllowances = [];
    const productId = Number(data.shift());
    const restrictedUntil = Number(data.shift());
    const valid = Boolean(Number(data.shift()));
    const invalidatedAt = Number(data.shift());
    const buildingAllowanceCount = Number(data.shift());

    for (let i = 0; i < buildingAllowanceCount; i += 1) {
      buildingAllowances.push({
        buildingType: Number(data.shift()),
        count: Number(data.shift())
      });
    }

    return {
      entity: entityFromPathValue(crewPath),
      productId,
      restrictedUntil,
      valid,
      invalidatedAt,
      buildingAllowances,
      lotAllowance: Number(data.shift()),
      foodReloadAllowance: Number(data.shift()),
      coreSampleAllowance: Number(data.shift())
    };
  }
}

module.exports = Handler;
