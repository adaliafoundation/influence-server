const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2f496cabdaec9b7554d4b14512cdc166b44e71d25ac462c97e83693667eabfe'],
    name: 'SellOrderCancelled'
  };

  async processEvent() {
    const { callerCrew, caller, exchange, sellerCrew, storage } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, exchange, sellerCrew, storage],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      sellerCrew: this._entityFromData(data),
      exchange: this._entityFromData(data),
      product: Number(data.shift()),
      price: Number(data.shift()),
      storage: this._entityFromData(data),
      storageSlot: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
