const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { extractInventories } = require('../../utils');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x71f718ed85b0a50883b97dcc26c6c7f93652d247eadc704f01c6fd0cd2f9c'],
    name: 'DeliveryDumped'
  };

  async processEvent() {
    const { callerCrew, caller, origin } = this.eventDoc.returnValues;
    const data = {};

    const [
      callerCrewEntity,
      crewmates,
      station,
      originEntity
    ] = await Promise.allSettled([
      EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true }),
      CrewmateService.findByCrew(callerCrew),
      CrewService.findStation(callerCrew),
      EntityService.getEntity({ ...origin, components: ['Location', 'Control'], format: true })
    ]);

    if (callerCrewEntity.value) data.crew = callerCrewEntity.value;
    if (crewmates.value) data.crewmates = crewmates.value;
    if (station.value) data.station = station.value;
    if (originEntity.value) data.origin = originEntity.value;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data,
      entities: [callerCrew, origin],
      event: this.eventDoc,
      hashKeys: ['name', 'returnValues.delivery.id'],
      unresolvedFor: []
    });

    if (activityResult?.created === 0) return;

    const originAsteroidEntity = await LocationComponentService.getAsteroidForEntity(origin);

    // add WS messages
    this.addCrewRoomMessage(callerCrew);
    if (originAsteroidEntity.value) this.addAsteroidRoomMessage(originAsteroidEntity.value);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      products: extractInventories(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
