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
    baseName: 'SamplingDepositStarted',
    keys: ['0x32039be09b842863a6f4b375165b6053610e5ff9ad5e9707cd8bc524347b0ba'],
    name: 'SamplingDepositStartedV1',
    version: 1
  };

  static hashKeys = [
    'name',
    'returnValues.deposit.id'
  ];

  async processEvent() {
    const { deposit, lot, callerCrew, caller } = this.eventDoc.returnValues;
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
      entities: [deposit, lot, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'SamplingDeposit',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      deposit: this._entityFromData(data),
      lot: this._entityFromData(data),
      resource: Number(data.shift()),
      improving: Boolean(Number(data.shift())),
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
