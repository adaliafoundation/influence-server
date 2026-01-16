const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys } = require('./ConstructionStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x19c0dc053b7efa91a4cbade696e4472eee63b398737a2612b9621461541be46'],
    name: 'ConstructionFinished'
  };

  async processEvent() {
    const { returnValues: { building, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [building, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('ConstructionStarted', this.eventDoc, hashKeys);

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const locationComponentDoc = await LocationComponentService.findOneByEntity(building);
    const asteroidEntity = locationComponentDoc?.getAsteroidLocation();
    const lotEntity = locationComponentDoc?.getLotLocation();

    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });

    if (lotEntity) await PackedLotDataService.updateBuildingTypeForLot(lotEntity);
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
