const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  ComponentService,
  EntityService,
  LocationComponentService,
  PackedLotDataService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3b4f143f00a8c052d0d1ff7f7065974025c84ff324cd0b2bd13a6acdbd655d8'],
    name: 'CrewEjected'
  };

  static hashKeys = [
    'name',
    'returnValues.ejectedCrew.id'
  ];

  async processEvent() {
    const { returnValues: { callerCrew, caller, ejectedCrew, station } } = this.eventDoc;
    const unresolvedFor = [];

    const crew = await EntityService.getEntity({ ...ejectedCrew, components: ['Crew', 'Location'], format: true });

    // If the eject happened from a ship in transit, need to add the crew(s) to the unresolvedFor
    const shipComponentDoc = await ComponentService.findOneByEntity('Ship', ejectedCrew);
    if (shipComponentDoc?.transitArrival > 0) unresolvedFor.push(callerCrew, ejectedCrew);

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [callerCrew, ejectedCrew, station],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const stationEntity = new Entity(station);
    if (!stationEntity.isAsteroid()) {
      const lotEntity = await LocationComponentService.getLotForEntity(stationEntity);
      if (lotEntity) await PackedLotDataService.updateLotCrewStatus(lotEntity);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      station: this._entityFromData(data),
      ejectedCrew: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
