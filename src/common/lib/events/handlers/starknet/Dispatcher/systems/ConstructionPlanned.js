const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3c3052208b487830d882c3f109449123d68bce392b5de64388f8884c9465439'],
    name: 'ConstructionPlanned'
  };

  async processEvent() {
    const { returnValues: { asteroid, building, callerCrew, caller, lot } } = this.eventDoc;

    const crew = await EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true });

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [asteroid, building, callerCrew, lot],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.addCrewRoomMessage(callerCrew);

    const locationComponentDoc = await LocationComponentService.findOneByEntity(building);
    const asteroidEntity = locationComponentDoc?.getAsteroidLocation();
    const lotEntity = locationComponentDoc?.getLotLocation();

    if (asteroidEntity) this.addAsteroidRoomMessage(asteroidEntity);
    if (lotEntity) await PackedLotDataService.update(lotEntity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      building: this._entityFromData(data),
      buildingType: Number(data.shift()),
      asteroid: this._entityFromData(data),
      lot: this._entityFromData(data),
      gracePeriodEnd: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
