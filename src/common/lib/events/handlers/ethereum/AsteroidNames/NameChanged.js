const config = require('config');
const Entity = require('@common/lib/Entity');
const { ActivityService, ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../BaseHandler');

class Handler extends BaseHandler {
  static eventName = 'NameChanged';

  static eventFilter = {
    DEPRECATED_AT: config.get('Events.handlers.ethereum.AsteroidNames.NameChanged.deprecatedAt')
  };

  async processEvent() {
    const { returnValues: { asteroidId, newName } } = this.eventDoc;
    const entity = Entity.Asteroid(asteroidId);

    await ComponentService.updateOrCreateFromEvent({
      component: 'Name',
      event: this.eventDoc,
      data: { entity, name: newName }
    });

    await ActivityService.findOrCreateOne({ entities: [entity], event: this.eventDoc });

    await ElasticSearchService.queueEntityForIndexing(entity);
  }
}

module.exports = Handler;
