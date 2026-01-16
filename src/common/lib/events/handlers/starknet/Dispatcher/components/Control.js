const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x436f6e74726f6c'
    ],
    name: 'ComponentUpdated_Control'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;
    const _entity = Entity.toEntity(entity);

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Control',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (!updated) return;
    await ElasticSearchService.queueEntityForIndexing(_entity);

    // if the entity is an asteroid, we need to reindex all buildings and lots on this asteroid
    if (_entity.isAsteroid()) {
      const buildingCursor = mongoose.model('LocationComponent')
        .find({ 'entity.label': Entity.IDS.BUILDING, 'locations.uuid': _entity.uuid })
        .select('entity')
        .lean()
        .cursor();

      const lotCursor = mongoose.model('Entity')
        .find({ label: Entity.IDS.LOT, 'asteroid.uuid': _entity.uuid }).cursor();

      await Promise.all([
        await ElasticSearchService.queueEntitiesForIndexing({ cursor: buildingCursor }),
        await ElasticSearchService.queueEntitiesForIndexing({
          cursor: lotCursor,
          getEntityFromDoc: (doc) => Entity.toEntity(doc)
        })
      ]);
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      controller: this._entityFromData(data)
    };
  }
}

module.exports = Handler;
