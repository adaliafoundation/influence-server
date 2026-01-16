const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService } = require('@common/services');
const { updateCrewmateAsset, updateAsteroidAsset } = require('@common/lib/marketplaces');
const logger = require('@common/lib/logger');
const { shortString } = require('starknet');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3e6786b59c4ea963504194850298c5c97a60f5889515ccf4ac1845f225b7aa0'],
    name: 'NameChanged'
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [entity, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      if (Entity.isAsteroid(entity)) await updateAsteroidAsset({ id: entity.id });
      if (Entity.isCrewmate(entity)) await updateCrewmateAsset({ id: entity.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      name: shortString.decodeShortString(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
