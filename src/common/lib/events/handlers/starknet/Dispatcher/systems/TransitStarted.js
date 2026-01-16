const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  LocationComponentService,
  ResolvableEventNotificationService } = require('@common/services');
const Logger = require('@common/lib/logger');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2761565e17a1f79060ba5b036ec0cede61ab529bbf309a58f97538bf8c1027b'],
    name: 'TransitStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.ship.id',
    'returnValues.origin.label',
    'returnValues.origin.id',
    'returnValues.destination.label',
    'returnValues.destination.id',
    'returnValues.departure',
    'returnValues.arrival'
  ];

  async processEvent() {
    const { callerCrew, caller, destination, origin, ship } = this.eventDoc.returnValues;
    const data = {};

    const results = await Promise.allSettled([
      EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true }),
      CrewmateService.findByCrew(callerCrew),
      CrewService.findStation(callerCrew)
    ]);

    if (results[0].value) data.crew = results[0].value;
    if (results[1].value) data.crewmates = results[1].value;
    if (results[2].value) data.station = results[2].value;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data,
      entities: [callerCrew, destination, origin, ship],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'Transit',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      const destAsteroidEntity = await LocationComponentService.getAsteroidForEntity(destination);
      const originAsteroidEntity = await LocationComponentService.getAsteroidForEntity(origin);
      if (destAsteroidEntity) this.messages.push({ to: `Asteroid::${destAsteroidEntity.id}` });
      if (originAsteroidEntity) this.messages.push({ to: `Asteroid::${originAsteroidEntity.id}` });
    } catch (error) {
      Logger.warn(error);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      origin: this._entityFromData(data),
      destination: this._entityFromData(data),
      departure: Number(data.shift()),
      arrival: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
