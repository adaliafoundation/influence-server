const { Address, Order } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, OrderComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1930f6701012e23710325233da61de3d0a5b8333169de1709d0ac3d5e88872f'],
    name: 'BuyOrderCreated'
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
      orderType: Order.IDS.LIMIT_BUY,
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
      exchange: { label: Number(data.shift()), id: Number(data.shift()) },
      product: Number(data.shift()),
      amount: Number(data.shift()),
      price: Number(data.shift()),
      storage: { label: Number(data.shift()), id: Number(data.shift()) },
      storageSlot: Number(data.shift()),
      validTime: Number(data.shift()),
      makerFee: Number(data.shift()),
      callerCrew: { label: Number(data.shift()), id: Number(data.shift()) },
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
