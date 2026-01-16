const { Address } = require('@influenceth/sdk');
const { pullAt, range } = require('lodash');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'CrewmatesArranged',
    keys: ['0x1a4527d06366f370dd689ea8fe186ab0e681a94edd846592b67197173f5ecea'],
    name: 'CrewmatesArrangedV1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      compositionOld: pullAt(data, range(0, Number(data.shift()))).map(Number),
      compositionNew: pullAt(data, range(0, Number(data.shift()))).map(Number),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
