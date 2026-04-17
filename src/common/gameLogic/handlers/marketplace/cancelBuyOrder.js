const { Entity, Order, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CancelBuyOrderHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'BuyOrderCancelled'; }

  async validate() {
    const {
      buyer_crew: buyerCrewRef, exchange: exchangeRef,
      product, amount, price,
      storage: storageRef, storage_slot: storageSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!buyerCrewRef?.id) throw new ValidationError('vars.buyer_crew with id is required');
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

    this.product = Number(product);
    this.amount = Number(amount) || 0;
    this.price = Number(price) || 0;
    this.storageSlot = Number(storageSlot) || 1;

    // Load storage inventory for clearing reservation
    const storageEntity = { id: storageRef.id, label: storageRef.label || Entity.IDS.BUILDING };
    const inventories = await ComponentService.findByEntity('Inventory', storageEntity);
    this.storageInv = inventories.find(i => i.slot === this.storageSlot);
  }

  async applyStateChanges() {
    // Mark the order as cancelled
    const orderFilter = {
      'entity.id': this.vars.exchange.id,
      'crew.id': this.vars.buyer_crew.id,
      orderType: Order.IDS.LIMIT_BUY,
      product: this.product,
      price: this.price,
      'storage.id': this.vars.storage.id,
      storageSlot: this.storageSlot
    };

    const existingOrder = await ComponentService.findOne('Order', orderFilter);
    if (existingOrder) {
      await this.writeComponent('Order', {
        entity: this.vars.exchange,
        crew: this.vars.buyer_crew,
        orderType: Order.IDS.LIMIT_BUY,
        product: this.product,
        amount: this.amount,
        price: this.price,
        storage: this.vars.storage,
        storageSlot: this.storageSlot,
        status: Order.STATUSES.CANCELLED,
        validTime: existingOrder.validTime,
        makerFee: existingOrder.makerFee
      });

      // Clear destination reservation that was made during createBuyOrder
      if (this.storageInv) {
        const orderAmount = existingOrder.amount || 0;
        const pt = Product.TYPES[this.product];
        const reservedMass = pt ? orderAmount * pt.massPerUnit : 0;
        const reservedVolume = pt ? orderAmount * pt.volumePerUnit : 0;

        const storageEntity = { id: this.vars.storage.id, label: this.vars.storage.label || Entity.IDS.BUILDING };
        await this.writeComponent('Inventory', {
          entity: storageEntity,
          inventoryType: this.storageInv.inventoryType,
          slot: this.storageInv.slot,
          status: this.storageInv.status,
          mass: this.storageInv.mass,
          volume: this.storageInv.volume,
          reservedMass: Math.max(0, (this.storageInv.reservedMass || 0) - reservedMass),
          reservedVolume: Math.max(0, (this.storageInv.reservedVolume || 0) - reservedVolume),
          contents: this.storageInv.contents
        });
      }
    }

    return {};
  }

  getReturnValues() {
    return {
      buyerCrew: this.vars.buyer_crew,
      exchange: this.vars.exchange,
      product: this.product,
      amount: this.amount,
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
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/BuyOrderCancelled');
  }
}

module.exports = CancelBuyOrderHandler;
