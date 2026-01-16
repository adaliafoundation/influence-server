const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'ShipAssemblyStarted',
    keys: ['0x188b277b6bac6a7731bdd2fa5dd292bab7f1fc9becf7415dfb19d99815e6ab7'],
    name: 'ShipAssemblyStartedV1',
    version: 1
  };

  static hashKeys = [
    'name',
    'returnValues.dryDock.id',
    'returnValues.dryDockSlot'
  ];

  async processEvent() {
    const { callerCrew, dryDock, origin, caller, ship } = this.eventDoc.returnValues;
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
      entities: [callerCrew, dryDock, origin, ship],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'ShipAssembly',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      shipType: Number(data.shift()),
      dryDock: this._entityFromData(data),
      dryDockSlot: Number(data.shift()),
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
