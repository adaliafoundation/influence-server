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
    keys: ['0x10c30eb384eb39931c4fb26d9f9be36179ce00c4439ad00ec241b649dfca152'],
    name: 'DeliveryCancelled'
  };

  async processEvent() {
    const { callerCrew, caller, dest, delivery, origin } = this.eventDoc.returnValues;
    const data = {};

    const [
      callerCrewEntity,
      crewmates,
      station,
      destEntity,
      originEntity,
      destAsteroidEntity,
      originAsteroidEntity
    ] = await Promise.allSettled([
      EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true }),
      CrewmateService.findByCrew(callerCrew),
      CrewService.findStation(callerCrew),
      EntityService.getEntity({ ...dest, components: ['Control'], format: true }),
      EntityService.getEntity({ ...origin, components: ['Control'], format: true }),
      LocationComponentService.getAsteroidForEntity(dest),
      LocationComponentService.getAsteroidForEntity(origin)
    ]);

    if (callerCrewEntity.value) data.crew = callerCrewEntity.value;
    if (crewmates.value) data.crewmates = crewmates.value;
    if (station.value) data.station = station.value;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data,
      entities: [callerCrew, dest, delivery, origin],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // resolve the DeliveryPackaged activity
    await ActivityService.resolveStartActivity('DeliveryPackaged', this.eventDoc, ['name', 'returnValues.delivery.id']);

    // add WS messages
    this.addCrewRoomMessage(callerCrew);
    if (destEntity.value?.Control?.controller) this.addCrewRoomMessage(destEntity.value.Control.controller);
    if (originEntity.value?.Control?.controller) this.addCrewRoomMessage(originEntity.value.Control.controller);
    if (destAsteroidEntity.value) this.addAsteroidRoomMessage(destAsteroidEntity.value);
    if (originAsteroidEntity.value) this.addAsteroidRoomMessage(originAsteroidEntity.value);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      products: extractInventories(data),
      dest: this._entityFromData(data),
      destSlot: Number(data.shift()),
      delivery: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
