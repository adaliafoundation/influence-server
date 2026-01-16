const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const { ActivityService, ComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x18012f7c5562b2f783f4b7b6e34d14970cd5355325a8ed3f2882b8928614cc7'],
    name: 'ArrivalRewardClaimed'
  };

  async processEvent() {
    const { returnValues: { asteroid, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created > 0) {
      this.messages.push({ to: `Crew::${callerCrew.id}` });
      this.messages.push({ to: `Asteroid::${asteroid.id}` });
    }

    await ComponentService.updateOrCreateFromEvent({
      component: 'AsteroidReward',
      event: this.eventDoc,
      data: { entity: Entity.toEntity(asteroid), hasArrivalStarterPack: false },
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
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
