const config = require('config');
const { Asteroid } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService, ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventName = 'AsteroidScanned';

  static eventFilter = {
    DEPRECATED_AT: config.get('Events.handlers.ethereum.AsteroidScans.AsteroidScanned.deprecatedAt')
  };

  async processEvent() {
    const { returnValues: { asteroidId, bonuses } } = this.eventDoc;
    const entity = Entity.Asteroid(asteroidId);

    await ComponentService.updateOrCreateFromEvent({
      component: 'Celestial',
      event: this.eventDoc,
      data: { entity, bonuses, scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNED },
      replace: false
    });

    await ActivityService.findOrCreateOne({ entities: [entity], event: this.eventDoc });

    await ElasticSearchService.queueEntityForIndexing(entity);
  }
}

module.exports = Handler;
