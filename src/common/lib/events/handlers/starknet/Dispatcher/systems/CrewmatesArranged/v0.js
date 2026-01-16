const { Address } = require('@influenceth/sdk');
const { pullAt, range } = require('lodash');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x381b62edeebd8bcbe9d4b935ffbe17cb8178a31cdc8017bc00a580bab62ca59'],
    name: 'CrewmatesArranged'
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
      composition: pullAt(data, range(0, Number(data.shift()))).map(Number),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
