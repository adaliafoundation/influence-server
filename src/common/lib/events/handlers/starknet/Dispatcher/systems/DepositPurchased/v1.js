const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x139f3e273ffde9597a38ee22f0fedc5c0b921eab036cf16cce18d63529045fb'],
    name: 'DepositPurchasedV1',
    baseName: 'DepositPurchased',
    version: 1
  };

  async processEvent() {
    const { callerCrew, sellerCrew, caller, deposit } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [sellerCrew, callerCrew, deposit],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: `Crew::${sellerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      deposit: this._entityFromData(data),
      price: Number(data.shift()),
      sellerCrew: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
