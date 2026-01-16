const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x325d06493a9283f4f75069a95086bb73c9842b8b2e91720895ba4fbb3bb8992'],
    name: 'BuyOrderCancelled'
  };

  async processEvent() {
    const { buyerCrew, callerCrew, caller, exchange, storage } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [buyerCrew, callerCrew, exchange, storage],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const [exchangeAstroidEntity, storageAstroidEntity] = await Promise.all([
      LocationComponentService.getAsteroidForEntity(exchange),
      LocationComponentService.getAsteroidForEntity(storage)
    ]);

    if (exchangeAstroidEntity) this.messages.push({ to: `Asteroid::${exchangeAstroidEntity.id}` });
    if (storageAstroidEntity) this.messages.push({ to: `Asteroid::${storageAstroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      buyerCrew: { label: Number(data.shift()), id: Number(data.shift()) },
      exchange: { label: Number(data.shift()), id: Number(data.shift()) },
      product: Number(data.shift()),
      amount: Number(data.shift()),
      price: Number(data.shift()),
      storage: { label: Number(data.shift()), id: Number(data.shift()) },
      storageSlot: Number(data.shift()),
      callerCrew: { label: Number(data.shift()), id: Number(data.shift()) },
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
