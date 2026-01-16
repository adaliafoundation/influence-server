const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x299d12261db430d6d61be5a1833a6080b96cdfebebbacbe89d8ff3c0cebf599'],
    name: 'BuyOrderFilled'
  };

  async processEvent() {
    const { buyerCrew, callerCrew, caller, exchange, origin, storage } = this.eventDoc.returnValues;
    const addresses = [caller];
    const entities = [buyerCrew, callerCrew, exchange, origin, storage];

    // get the controllers for the exchange, origin and storage
    const [
      { value: originEntity },
      { value: storageEntity }
    ] = await Promise.allSettled([
      EntityService.getEntity({ ...origin, components: ['Control'], format: true }),
      EntityService.getEntity({ ...storage, components: ['Control'], format: true })
    ]);

    if (originEntity?.Control?.controller) entities.push(originEntity.Control.controller);
    if (storageEntity?.Control?.controller) entities.push(storageEntity.Control.controller);

    const activityResult = await ActivityService.findOrCreateOne({
      addresses,
      entities,
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    const [exchangeAstroidEntity, storageAstroidEntity] = await Promise.all([
      LocationComponentService.getAsteroidForEntity(exchange),
      LocationComponentService.getAsteroidForEntity(storage)
    ]);

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: `Crew::${buyerCrew.id}` });
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
      origin: { label: Number(data.shift()), id: Number(data.shift()) },
      originSlot: Number(data.shift()),
      callerCrew: { label: Number(data.shift()), id: Number(data.shift()) },
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
