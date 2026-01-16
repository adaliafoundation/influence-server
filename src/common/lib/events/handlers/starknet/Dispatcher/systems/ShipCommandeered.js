const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x118a1ca7593e405c95a6c5f2d2c5a47e91186ea09084841e3617e1546ac4d6b'],
    name: 'ShipCommandeered'
  };

  async processEvent() {
    const { ship, callerCrew, caller } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [ship, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
