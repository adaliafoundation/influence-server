const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2032457432fdc3444a9d87d36c03b163de510f154164b8a6e17d305b2513e5a'],
    name: 'ResourceExtractionStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.extractor.id',
    'returnValues.extractorSlot',
    'returnValues.resource',
    'returnValues.destination.id',
    'returnValues.destinationSlot'
  ];

  async processEvent() {
    const { deposit, extractor, destination, callerCrew, caller } = this.eventDoc.returnValues;
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
      entities: [deposit, extractor, destination, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'ResourceExtraction',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      deposit: this._entityFromData(data),
      resource: Number(data.shift()),
      yield: Number(data.shift()),
      extractor: this._entityFromData(data),
      extractorSlot: Number(data.shift()),
      destination: this._entityFromData(data),
      destinationSlot: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
