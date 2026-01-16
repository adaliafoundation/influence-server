const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const { ActivityService, ComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xd4f91e19823663b9951b39aade9cbab268b44c7c0f8805977065cb400d0e55'],
    name: 'PrepareForLaunchRewardClaimed'
  };

  async processEvent() {
    const { returnValues: { asteroid, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Asteroid::${asteroid.id}` });

    await ComponentService.updateOrCreateFromEvent({
      component: 'AsteroidReward',
      event: this.eventDoc,
      data: { entity: Entity.toEntity(asteroid), hasPrepareForLaunchCrewmate: false },
      replace: false
    });

    try {
      await updateAsteroidAsset({ id: asteroid.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
