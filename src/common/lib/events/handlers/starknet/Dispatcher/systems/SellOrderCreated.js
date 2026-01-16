const { Address, Order } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, OrderComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xb09fa3d261ee6e57bf0d388897148f75d4dd5601c1ec069b8a5c55e90d684c'],
    name: 'SellOrderCreated'
  };

  async processEvent() {
    const { callerCrew, caller, exchange, storage } = this.eventDoc.returnValues;

    const crew = await EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true });

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [callerCrew, exchange, storage],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    // attempt to find the order component document and set the initialCaller
    await OrderComponentService.updateInitialCaller({
      entity: exchange,
      crew: callerCrew,
      orderType: Order.IDS.LIMIT_SELL,
      product: this.eventDoc.returnValues.product,
      price: this.eventDoc.returnValues.price,
      storage,
      storageSlot: this.eventDoc.returnValues.storageSlot,
      initialCaller: caller
    });

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
      exchange: this._entityFromData(data),
      product: Number(data.shift()),
      amount: Number(data.shift()),
      price: Number(data.shift()),
      storage: this._entityFromData(data),
      storageSlot: Number(data.shift()),
      validTime: Number(data.shift()),
      makerFee: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
