const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');
const { extractInventories } = require('../../../utils');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'MaterialProcessingStarted',
    keys: ['0x3065adaec3635cf39a14af3ca256db24878ed04ac9a67e4da02df245920e5e3'],
    name: 'MaterialProcessingStartedV1',
    version: 1
  };

  static hashKeys = [
    'name',
    'returnValues.processor.id',
    'returnValues.processorSlot'
  ];

  async processEvent() {
    const { processor, origin, destination, callerCrew, caller } = this.eventDoc.returnValues;
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
      entities: [processor, origin, destination, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'MaterialProcessing',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      processor: this._entityFromData(data),
      processorSlot: Number(data.shift()),
      process: Number(data.shift()),
      inputs: extractInventories(data),
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      outputs: extractInventories(data),
      destination: this._entityFromData(data),
      destinationSlot: Number(data.shift()),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
