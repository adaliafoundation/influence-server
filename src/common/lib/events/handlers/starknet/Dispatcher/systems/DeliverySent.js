const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  LocationComponentService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { extractInventories } = require('../../utils');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x10de2c3a76c0f5578db9e2b41a7d26287176d2433159174cfe2fcb36e19dbaa'],
    name: 'DeliverySent'
  };

  async processEvent() {
    const { callerCrew, caller, dest, delivery, origin } = this.eventDoc.returnValues;
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
      entities: [callerCrew, dest, delivery, origin],
      event: this.eventDoc,
      hashKeys: ['name', 'returnValues.delivery.id'],
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'Delivery',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    const [
      destEntity,
      destAsteroidEntity,
      originAsteroidEntity
    ] = await Promise.allSettled([
      EntityService.getEntity({ ...dest, components: ['Control'], format: true }),
      LocationComponentService.getAsteroidForEntity(dest),
      LocationComponentService.getAsteroidForEntity(origin)
    ]);

    // resolve the DeliveryPackaged activity
    await ActivityService.resolveStartActivity('DeliveryPackaged', this.eventDoc, ['name', 'returnValues.delivery.id']);

    // add WS messages
    this.addCrewRoomMessage(callerCrew);
    if (destEntity?.value?.Control?.controller) this.addCrewRoomMessage(destEntity.value.Control.controller);
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
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
