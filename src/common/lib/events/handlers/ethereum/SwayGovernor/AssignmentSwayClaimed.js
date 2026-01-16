const Entity = require('@common/lib/Entity');
const { ComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventName = 'AssignmentSwayClaimed';

  async processEvent() {
    const { returnValues: { asteroidIds, crewmateIds } } = this.eventDoc;

    // For each asteroid, update the corresponding AsteroidRewardComponent, set hasSwayClaim to false
    await Promise.all(asteroidIds.map(async (asteroidId) => {
      const entity = Entity.Asteroid(asteroidId);
      return ComponentService.updateOrCreateFromEvent({
        event: this.eventDoc,
        component: 'AsteroidReward',
        filter: { 'entity.uuid': entity.uuid },
        data: { entity, hasSwayClaim: false },
        replace: false
      });
    }));

    // For each crewmate, update the corresponding CrewmateRewardComponent, set hasSwayClaim to false
    await Promise.all(crewmateIds.map(async (crewmateId) => {
      const entity = Entity.Crewmate(crewmateId);
      return ComponentService.updateOrCreateFromEvent({
        event: this.eventDoc,
        component: 'CrewmateReward',
        filter: { 'entity.uuid': entity.uuid },
        data: { entity, hasSwayClaim: false },
        replace: false
      });
    }));
  }
}

module.exports = Handler;
