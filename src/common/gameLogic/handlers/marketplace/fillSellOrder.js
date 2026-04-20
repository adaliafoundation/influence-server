const { Entity, Order } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class FillSellOrderHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SellOrderFilled'; }

  async validate() {
    const {
      seller_crew: sellerCrewRef, exchange: exchangeRef,
      product, amount, price,
      storage: storageRef, storage_slot: storageSlot,
      destination: destRef, destination_slot: destSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!sellerCrewRef?.id) throw new ValidationError('vars.seller_crew with id is required');
    if (!exchangeRef?.id) throw new ValidationError('vars.exchange with id is required');
    if (!storageRef?.id) throw new ValidationError('vars.storage with id is required');
    if (!destRef?.id) throw new ValidationError('vars.destination with id is required');
    if (!product) throw new ValidationError('vars.product is required');
    if (!amount || amount <= 0) throw new ValidationError('vars.amount must be positive');

    // 1. Caller crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.product = Number(product);
    this.amount = Number(amount);
    this.price = Number(price) || 0;
    this.storageSlot = Number(storageSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
  }

  async applyStateChanges() {
    // Find and update the existing sell order
    const orderFilter = {
      'entity.id': this.vars.exchange.id,
      'crew.id': this.vars.seller_crew.id,
      orderType: Order.IDS.LIMIT_SELL,
      product: this.product,
      price: this.price,
      'storage.id': this.vars.storage.id,
      storageSlot: this.storageSlot
    };

    const existingOrder = await ComponentService.findOne({ component: 'Order', filter: orderFilter });
    if (existingOrder) {
      const newAmount = (existingOrder.amount || 0) - this.amount;
      await this.writeComponent('Order', {
        entity: this.vars.exchange,
        crew: this.vars.seller_crew,
        orderType: Order.IDS.LIMIT_SELL,
        product: this.product,
        amount: Math.max(0, newAmount),
        price: this.price,
        storage: this.vars.storage,
        storageSlot: this.storageSlot,
        status: newAmount <= 0 ? Order.STATUSES.FILLED : Order.STATUSES.OPEN,
        validTime: existingOrder.validTime,
        makerFee: existingOrder.makerFee
      });
    }

    return {};
  }

  getReturnValues() {
    return {
      sellerCrew: this.vars.seller_crew,
      exchange: this.vars.exchange,
      product: this.product,
      amount: this.amount,
      price: this.price,
      storage: this.vars.storage,
      storageSlot: this.storageSlot,
      destination: this.vars.destination,
      destinationSlot: this.destSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SellOrderFilled');
  }
}

module.exports = FillSellOrderHandler;
