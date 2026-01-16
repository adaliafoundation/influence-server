const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'CrewStationed',
    keys: ['0x24643fce7a4e37d012f05c1242ecc6def98463fe73bf6cc2f2a6828b9575fb5'],
    name: 'CrewStationedV1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, destinationStation, originStation } } = this.eventDoc;

    const crew = await EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true });

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [callerCrew, destinationStation, originStation],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.addCrewRoomMessage(callerCrew);

    const originStationEntity = new Entity(originStation);
    const destinationStationEntity = new Entity(destinationStation);

    if (!destinationStationEntity.isAsteroid()) {
      const lotEntity = await LocationComponentService.getLotForEntity(destinationStationEntity);
      if (lotEntity) await PackedLotDataService.updateLotCrewStatus(lotEntity);
    }

    if (!originStationEntity.isAsteroid()) {
      const lotEntity = await LocationComponentService.getLotForEntity(originStationEntity);
      if (lotEntity) await PackedLotDataService.updateLotCrewStatus(lotEntity);
    }

    const originAsteroidEntity = await LocationComponentService.getAsteroidForEntity(originStationEntity);
    const destAsteroidEntity = await LocationComponentService.getAsteroidForEntity(destinationStationEntity);
    if (originAsteroidEntity) this.addAsteroidRoomMessage(originAsteroidEntity);
    if (destAsteroidEntity) this.addAsteroidRoomMessage(destAsteroidEntity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      originStation: this._entityFromData(data),
      destinationStation: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
