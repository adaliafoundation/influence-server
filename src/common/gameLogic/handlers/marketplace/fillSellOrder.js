const { Address, Entity, Order, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const logger = require('@common/lib/logger');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

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

    // Load seller's storage inventory (to clear reservation)
    const sellerStorageEntity = { id: storageRef.id, label: storageRef.label || Entity.IDS.BUILDING };
    const sellerInventories = await ComponentService.findByEntity('Inventory', sellerStorageEntity);
    this.sellerStorageInv = sellerInventories.find(i => i.slot === this.storageSlot);

    // Load buyer's destination inventory (to add products)
    const destEntity = { id: destRef.id, label: destRef.label || Entity.IDS.BUILDING };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    this.destInv = destInventories.find(i => i.slot === this.destSlot);
  }

  async applyStateChanges() {
    // SWAY, with marketplace fees. Cairo splits a LIMIT_SELL fill
    // (orders.cairo `required_payments`) into:
    //   buyer  pays    value + takerFee
    //   seller gets    value - makerFee
    //   market gets    makerFee + takerFee
    // makerFee is frozen on the order at creation, takerFee comes from the
    // exchange config at fill time.
    const orderFilter = {
      'entity.id': this.vars.exchange.id,
      'crew.id': this.vars.seller_crew.id,
      orderType: Order.IDS.LIMIT_SELL,
      product: this.product,
      price: this.price,
      'storage.id': this.vars.storage.id,
      storageSlot: this.storageSlot
    };
    const existingOrderForFees = await ComponentService.findOne('Order', orderFilter);
    const exchangeComponent = await ComponentService.findOneByEntity('Exchange', this.vars.exchange);
    const makerFee = existingOrderForFees?.makerFee || 0;
    const takerFee = exchangeComponent?.takerFee || 0;

    const { valueWei, makerFeeWei, takerFeeWei, feesWei } = Sway.computeFees({
      price: this.price, amount: this.amount, makerFee, takerFee
    });
    const sellerAddress = await Sway.addressOfCrew(this.vars.seller_crew);
    if (!sellerAddress) throw new ValidationError('Seller wallet not found');
    const marketAddress = await Sway.addressOfExchangeController(this.vars.exchange);

    // Debit the buyer (caller) for value + takerFee. One debit keeps the
    // "insufficient SWAY" error clean.
    await Sway.debit(Address.toStandard(this.address), valueWei + takerFeeWei);
    // Credit the seller (value - makerFee) and the exchange (both fees).
    await Sway.credit(sellerAddress, valueWei - makerFeeWei);
    if (marketAddress && feesWei > 0n) await Sway.credit(marketAddress, feesWei);
    else if (feesWei > 0n) logger.warn('FillSellOrder: exchange has no controller, fees burned');

    // Find and update the existing sell order
    const existingOrder = existingOrderForFees;
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

    const pt = Product.TYPES[this.product];
    const filledMass = pt ? this.amount * pt.massPerUnit : 0;
    const filledVolume = pt ? this.amount * pt.volumePerUnit : 0;

    // Unreserve seller's storage (reservation was made during createSellOrder)
    if (this.sellerStorageInv) {
      const sellerStorageEntity = { id: this.vars.storage.id, label: this.vars.storage.label || Entity.IDS.BUILDING };
      await this.writeComponent('Inventory', {
        entity: sellerStorageEntity,
        inventoryType: this.sellerStorageInv.inventoryType,
        slot: this.sellerStorageInv.slot,
        status: this.sellerStorageInv.status,
        mass: this.sellerStorageInv.mass,
        volume: this.sellerStorageInv.volume,
        reservedMass: Math.max(0, (this.sellerStorageInv.reservedMass || 0) - filledMass),
        reservedVolume: Math.max(0, (this.sellerStorageInv.reservedVolume || 0) - filledVolume),
        contents: this.sellerStorageInv.contents
      });
    }

    // Add products directly to buyer's destination inventory. We reject
    // product-type mismatches here (tank farm won't accept Steel, etc.)
    // instead of trusting the client to have filtered the destination.
    if (this.destInv) {
      this._assertInventoryAccepts(this.destInv, [{ product: this.product, amount: this.amount }]);

      const updatedContents = [...(this.destInv.contents || [])];
      const existing = updatedContents.find(c => c.product === this.product);
      if (existing) {
        existing.amount += this.amount;
      } else {
        updatedContents.push({ product: this.product, amount: this.amount });
      }

      let newMass = 0;
      let newVolume = 0;
      for (const c of updatedContents) {
        const cpt = Product.TYPES[c.product];
        if (cpt) { newMass += c.amount * cpt.massPerUnit; newVolume += c.amount * cpt.volumePerUnit; }
      }

      const destEntity = { id: this.vars.destination.id, label: this.vars.destination.label || Entity.IDS.BUILDING };
      await this.writeComponent('Inventory', {
        entity: destEntity,
        inventoryType: this.destInv.inventoryType,
        slot: this.destInv.slot,
        status: this.destInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: this.destInv.reservedMass,
        reservedVolume: this.destInv.reservedVolume,
        contents: updatedContents
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
