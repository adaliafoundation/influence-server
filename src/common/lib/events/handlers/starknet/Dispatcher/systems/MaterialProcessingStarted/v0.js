const { Address } = require('@influenceth/sdk');
const { ActivityService, CrewmateService, CrewService, EntityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');
const { extractInventories } = require('../../../utils');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x6d1606243c64dfb1f9aaa4c4ea6d9e35b9d6025c79263889b17770e9c68b61'],
    name: 'MaterialProcessingStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.processor.id',
    'returnValues.processorSlot'
  ];

  async processEvent() {
    const { processor, destination, callerCrew, caller } = this.eventDoc.returnValues;
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
      entities: [processor, destination, callerCrew],
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
      processor: this._entityFromData(data),
      processorSlot: Number(data.shift()),
      process: Number(data.shift()),
      inputs: extractInventories(data),
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
