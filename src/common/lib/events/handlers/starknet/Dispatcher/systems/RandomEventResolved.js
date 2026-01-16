const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x147a73243eca65757d646dc44d0829adb4e092c34ee952f9c01f3e0a89870b5'],
    name: 'RandomEventResolved'
  };

  async processEvent() {
    const { returnValues: { actionTarget, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [actionTarget, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: this.getRoomFromEntity(actionTarget) });
    this.messages.push({ to: this.getRoomFromEntity(callerCrew) });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      randomEvent: Number(data.shift()),
      choice: Number(data.shift()),
      actionType: Number(data.shift()),
      actionTarget: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
