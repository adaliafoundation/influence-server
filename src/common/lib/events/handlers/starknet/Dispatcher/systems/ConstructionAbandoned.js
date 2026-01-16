const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2f300392d1506272d80f8d4d58d86409cede4d0f4e30dd2eeb9d5b7390df1bb'],
    name: 'ConstructionAbandoned'
  };

  async processEvent() {
    const { returnValues: { building, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [building, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const locationComponentDoc = await LocationComponentService.findOneByEntity(building);
    const asteroidEntity = locationComponentDoc?.getAsteroidLocation();
    const lotEntity = locationComponentDoc?.getLotLocation();

    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });

    if (lotEntity) await PackedLotDataService.updateBuildingTypeForLot(new Entity(lotEntity));
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      building: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
