const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3427759bfd3b941f14e687e129519da3c9b0046c5b9aaa290bb1dede63753b3'],
    name: 'OrderCreated'
  };

  async processEvent() {
    const { returnValues: { order, exchange, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [order, exchange, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      order: this._entityFromData(data),
      orderType: Number(data.shift()),
      product: Number(data.shift()),
      amount: Number(data.shift()),
      exchange: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
