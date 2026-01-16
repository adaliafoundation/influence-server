const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2df90525e8a75383064e68e37c015a4ed0f4156903c24f300427a6be559f4d8'],
    name: 'SellOrderFilled'
  };

  async processEvent() {
    const { callerCrew, caller, destination, exchange, sellerCrew, storage } = this.eventDoc.returnValues;
    const entities = [callerCrew, destination, exchange, sellerCrew, storage];
    const addresses = [caller];

    // get the controllers for the destination, exchange and storage
    const [
      { value: destinationEntity },
      { value: storageEntity }
    ] = await Promise.allSettled([
      EntityService.getEntity({ ...destination, components: ['Control'], format: true }),
      EntityService.getEntity({ ...exchange, components: ['Control'], format: true }),
      EntityService.getEntity({ ...storage, components: ['Control'], format: true })
    ]);

    if (destinationEntity?.Control?.controller) entities.push(destinationEntity.Control.controller);
    if (storageEntity?.Control?.controller) entities.push(storageEntity.Control.controller);

    const activityResult = await ActivityService.findOrCreateOne({ addresses, entities, event: this.eventDoc });

    if (activityResult?.created === 0) return;

    const [exchangeAstroidEntity, storageAstroidEntity] = await Promise.all([
      LocationComponentService.getAsteroidForEntity(exchange),
      LocationComponentService.getAsteroidForEntity(storage)
    ]);

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: `Crew::${sellerCrew.id}` });
    if (exchangeAstroidEntity) this.messages.push({ to: `Asteroid::${exchangeAstroidEntity.id}` });
    if (storageAstroidEntity) this.messages.push({ to: `Asteroid::${storageAstroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      sellerCrew: this._entityFromData(data),
      exchange: this._entityFromData(data),
      product: Number(data.shift()),
      amount: Number(data.shift()),
      price: Number(data.shift()),
      storage: this._entityFromData(data),
      storageSlot: Number(data.shift()),
      destination: this._entityFromData(data),
      destinationSlot: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
