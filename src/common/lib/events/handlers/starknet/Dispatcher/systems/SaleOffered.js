const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x290931dd3c9166f84abfa89358f1a7576418392a8b7643c36838b6800a1ec3d'],
    name: 'SaleOffered'
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller } } = this.eventDoc;
    await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [entity, callerCrew],
      event: this.eventDoc
    });
    this.messages.push({ to: `Crew::${this.eventDoc.returnValues.callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      amount: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
