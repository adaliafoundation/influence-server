const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3d5d05a14fa3e6bacd911be17a18ecb41804a1ca3eb74e82d62507985c35d40'],
    name: 'AddedAccountToWhitelist'
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller, permitted } } = this.eventDoc;
    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller, permitted],
      entities: [entity, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: permitted });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      permission: Number(data.shift()),
      permitted: Address.toStandard(data.shift(), 'starknet'),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
