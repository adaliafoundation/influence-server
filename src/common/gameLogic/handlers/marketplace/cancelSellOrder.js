const { Entity, Order } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CancelSellOrderHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SellOrderCancelled'; }

  async validate() {
    const {
      seller_crew: sellerCrewRef, exchange: exchangeRef,
      product, price,
      storage: storageRef, storage_slot: storageSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!sellerCrewRef?.id) throw new ValidationError('vars.seller_crew with id is required');
    if (!exchangeRef?.id) throw new ValidationError('vars.exchange with id is required');
    if (!storageRef?.id) throw new ValidationError('vars.storage with id is required');
    if (!product) throw new ValidationError('vars.product is required');

    // 1. Caller crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // Find the existing order to get amount
    const orderFilter = {
      'entity.id': exchangeRef.id,
      'crew.id': sellerCrewRef.id,
      orderType: Order.IDS.LIMIT_SELL,
      product: Number(product),
      price: Number(price),
      'storage.id': storageRef.id,
      storageSlot: Number(storageSlot) || 1
    };

    this.existingOrder = await ComponentService.findOne({ component: 'Order', filter: orderFilter });

    this.product = Number(product);
    this.price = Number(price) || 0;
    this.storageSlot = Number(storageSlot) || 1;
  }

  async applyStateChanges() {
    if (this.existingOrder) {
      await this.writeComponent('Order', {
        entity: this.vars.exchange,
        crew: this.vars.seller_crew,
        orderType: Order.IDS.LIMIT_SELL,
        product: this.product,
        amount: this.existingOrder.amount || 0,
        price: this.price,
        storage: this.vars.storage,
        storageSlot: this.storageSlot,
        status: Order.STATUSES.CANCELLED,
        validTime: this.existingOrder.validTime,
        makerFee: this.existingOrder.makerFee
      });
    }

    return {};
  }

  getReturnValues() {
    return {
      sellerCrew: this.vars.seller_crew,
      exchange: this.vars.exchange,
      product: this.product,
      price: this.price,
      storage: this.vars.storage,
      storageSlot: this.storageSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SellOrderCancelled');
  }
}

module.exports = CancelSellOrderHandler;
