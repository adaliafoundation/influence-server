const { Address } = require('@influenceth/sdk');
const { ActivityService, CrewmateService, CrewService, EntityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x192752fb5963174574829304bf0d0495621c71d71b72cb866de671496fb496'],
    name: 'ShipAssemblyStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.dryDock.id',
    'returnValues.dryDockSlot'
  ];

  async processEvent() {
    const { callerCrew, dryDock, caller, ship } = this.eventDoc.returnValues;
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
      entities: [callerCrew, dryDock, ship],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      dryDock: this._entityFromData(data),
      dryDockSlot: Number(data.shift()),
      shipType: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
