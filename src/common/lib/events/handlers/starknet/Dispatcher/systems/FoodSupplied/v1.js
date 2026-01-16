const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'FoodSupplied',
    keys: ['0x644798dd8cb708a1b6c59a8272338d4b75f52ba46504bf2d85108b6d4800fd'],
    name: 'FoodSuppliedV1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { origin, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [origin, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      food: Number(data.shift()),
      lastFed: Number(data.shift()),
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
