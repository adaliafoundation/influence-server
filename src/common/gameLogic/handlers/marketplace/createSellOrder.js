const { Entity, Order } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CreateSellOrderHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SellOrderCreated'; }

  async validate() {
    const {
      exchange: exchangeRef, product, amount, price,
      storage: storageRef, storage_slot: storageSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!exchangeRef?.id) throw new ValidationError('vars.exchange with id is required');
    if (!storageRef?.id) throw new ValidationError('vars.storage with id is required');
    if (!product) throw new ValidationError('vars.product is required');
    if (!amount || amount <= 0) throw new ValidationError('vars.amount must be positive');
    if (!price || price <= 0) throw new ValidationError('vars.price must be positive');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Exchange (building) must exist
    this.exchange = await EntityService.getEntity({
      id: exchangeRef.id,
      label: exchangeRef.label || Entity.IDS.BUILDING,
      components: ['Exchange'],
      format: true
    });
    if (!this.exchange) throw new ValidationError('Exchange not found');

    this.product = Number(product);
    this.amount = Number(amount);
    this.price = Number(price);
    this.storageSlot = Number(storageSlot) || 1;
    this.makerFee = this.exchange.Exchange?.makerFee || 0;
    this.validTime = Math.floor(Date.now() / 1000);
  }

  async applyStateChanges() {
    await this.writeComponent('Order', {
      entity: { id: this.exchange.id, label: this.exchange.label || Entity.IDS.BUILDING },
      crew: this.vars.caller_crew,
      orderType: Order.IDS.LIMIT_SELL,
      product: this.product,
      amount: this.amount,
      price: this.price,
      storage: this.vars.storage,
      storageSlot: this.storageSlot,
      status: Order.STATUSES.OPEN,
      validTime: this.validTime,
      makerFee: this.makerFee
    });

    return {};
  }

  getReturnValues() {
    return {
      exchange: this.vars.exchange,
      product: this.product,
      amount: this.amount,
      price: this.price,
      storage: this.vars.storage,
      storageSlot: this.storageSlot,
      validTime: this.validTime,
      makerFee: this.makerFee,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SellOrderCreated');
  }
}

module.exports = CreateSellOrderHandler;
