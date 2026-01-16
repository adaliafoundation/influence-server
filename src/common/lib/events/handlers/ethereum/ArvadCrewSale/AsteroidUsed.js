const { ComponentService, ElasticSearchService } = require('@common/services');
const logger = require('@common/lib/logger');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../Handler');
const { getFeaturesAndAppearance } = require('./utils');

class Handler extends BaseHandler {
  static eventName = 'AsteroidUsed';

  async _getFeaturesAndAppearance(crewId) {
    try {
      const { appearance, features } = await getFeaturesAndAppearance(crewId);
      return { appearance, features };
    } catch (e) {
      logger.warn(e.message || e);
      throw e;
    }
  }

  async processEvent() {
    const { returnValues: { asteroidId, crewId } } = this.eventDoc.toObject();
    const asteroidEntity = Entity.Asteroid(asteroidId);
    const crewmateEntity = Entity.Crewmate(crewId);

    const { appearance, features } = await this._getFeaturesAndAppearance(crewId);

    await ComponentService.updateOrCreateFromEvent({
      component: 'Crewmate',
      event: this.eventDoc,
      data: {
        entity: crewmateEntity,
        appearance,
        class: features.class,
        coll: features.coll,
        title: features.title
      },
      replace: false
    });

    await ComponentService.updateOrCreateFromEvent({
      event: this.eventDoc,
      component: 'CrewmateReward',
      filter: { 'entity.uuid': crewmateEntity.uuid },
      data: { entity: crewmateEntity, hasSwayClaim: true }
    });

    await ComponentService.updateOrCreateFromEvent({
      component: 'AsteroidReward',
      event: this.eventDoc,
      data: { entity: asteroidEntity, hasMintableCrewmate: false },
      replace: false
    });

    await Promise.all([
      ElasticSearchService.queueEntityForIndexing(asteroidEntity),
      ElasticSearchService.queueEntityForIndexing(crewmateEntity)
    ]);
  }
}

module.exports = Handler;
