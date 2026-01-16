const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x20291aa913b873ebd27f3feb72066d5dd7129467c032208b1064d06002f2aa2'],
    name: 'CrewStationed'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, station } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, station],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.addCrewRoomMessage(callerCrew);

    const stationEntity = new Entity(station);
    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(stationEntity);
    if (asteroidEntity) this.addAsteroidRoomMessage(asteroidEntity);

    if (!stationEntity.isAsteroid()) {
      const lotEntity = await LocationComponentService.getLotForEntity(stationEntity);
      if (lotEntity) await PackedLotDataService.updateLotCrewStatus(lotEntity);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      station: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
