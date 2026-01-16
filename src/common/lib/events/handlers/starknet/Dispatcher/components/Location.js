const { Entity } = require('@influenceth/sdk');
const { ComponentService, ElasticSearchService, LocationComponentService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4c6f636174696f6e'
    ],
    name: 'ComponentUpdated_Location'
  };

  async processEvent() {
    const { returnValues: { entity, location } } = this.eventDoc;

    // calculate the full location for the entity
    const fullLocation = await LocationComponentService.getFullLocation(location);

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Location',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues, locations: fullLocation },
      replace: true
    });

    if (!updated) return;
    await ElasticSearchService.queueEntityForIndexing(entity);

    // If we are updating a ship's location componet data, we need to update crew's full location
    if (entity.label === Entity.IDS.SHIP) await LocationComponentService.refreshCrewLocationsAtLocation(entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      location: this._entityFromData(data)
    };
  }
}

module.exports = Handler;
