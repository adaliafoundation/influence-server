const { Entity, Order, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const logger = require('@common/lib/logger');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

class FillBuyOrderHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'BuyOrderFilled'; }

  async validate() {
    const {
      buyer_crew: buyerCrewRef, exchange: exchangeRef,
      product, amount, price,
      storage: storageRef, storage_slot: storageSlot,
      origin: originRef, origin_slot: originSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!buyerCrewRef?.id) throw new ValidationError('vars.buyer_crew with id is required');
    if (!exchangeRef?.id) throw new ValidationError('vars.exchange with id is required');
    if (!storageRef?.id) throw new ValidationError('vars.storage with id is required');
    if (!originRef?.id) throw new ValidationError('vars.origin with id is required');
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
    this.originSlot = Number(originSlot) || 1;

    // Seller (caller) must have REMOVE_PRODUCTS on the origin inventory's
    // host entity — can't fulfill a buy order from a warehouse you can't
    // pull from.
    const originHostEntity = await EntityService.getEntity({
      id: originRef.id, label: originRef.label || Entity.IDS.BUILDING,
      components: ['Location', 'Control'], format: true
    });
    if (!originHostEntity) throw new ValidationError('Origin entity not found');
    await AccessValidator.assertPermission(
      this.crew, originHostEntity, require('@influenceth/sdk').Permission.IDS.REMOVE_PRODUCTS
    );

    // Load seller's origin inventory (to deduct products)
    const originEntity = { id: originRef.id, label: originRef.label || Entity.IDS.BUILDING };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    this.originInv = originInventories.find(i => i.slot === this.originSlot);
    if (!this.originInv) throw new ValidationError('Origin inventory slot not found');

    // Origin must actually contain enough of the product. Cairo checks
    // this in fill_buy.cairo; without it a seller could commit to a fill
    // they can't deliver.
    const originStock = (this.originInv.contents || []).find(c => c.product === this.product)?.amount || 0;
    if (originStock < this.amount) {
      throw new ValidationError(`Insufficient product at origin (have ${originStock}, need ${this.amount})`);
    }

    // Load buyer's storage inventory (to add products and clear reservation)
    const buyerStorageEntity = { id: storageRef.id, label: storageRef.label || Entity.IDS.BUILDING };
    const buyerInventories = await ComponentService.findByEntity('Inventory', buyerStorageEntity);
    this.buyerStorageInv = buyerInventories.find(i => i.slot === this.storageSlot);
  }

  async applyStateChanges() {
    // SWAY: buyer's escrow (value + makerFee) now splits — per Cairo
    // `required_withdrawals` (orders.cairo:53):
    //   seller (caller/taker) receives  value - takerFee
    //   exchange receives               makerFee + takerFee
    // The remaining balance in escrow after both payouts is zero (the
    // buyer's extra makerFee-worth pre-payment covers the shortfall).
    const orderFilter = {
      'entity.id': this.vars.exchange.id,
      'crew.id': this.vars.buyer_crew.id,
      orderType: Order.IDS.LIMIT_BUY,
      product: this.product,
      price: this.price,
      'storage.id': this.vars.storage.id,
      storageSlot: this.storageSlot
    };
    const existingOrderForFees = await ComponentService.findOne('Order', orderFilter);
    const exchangeComponent = await ComponentService.findOneByEntity('Exchange', this.vars.exchange);
    const makerFee = existingOrderForFees?.makerFee || 0;
    const takerFee = exchangeComponent?.takerFee || 0;

    const { valueWei, takerFeeWei, feesWei } = Sway.computeFees({
      price: this.price, amount: this.amount, makerFee, takerFee
    });
    const sellerAddress = await Sway.addressOfCrew(this.vars.caller_crew);
    if (!sellerAddress) throw new ValidationError('Seller wallet not found');
    const marketAddress = await Sway.addressOfExchangeController(this.vars.exchange);

    await Sway.credit(sellerAddress, valueWei - takerFeeWei);
    if (marketAddress && feesWei > 0n) await Sway.credit(marketAddress, feesWei);
    else if (feesWei > 0n) logger.warn('FillBuyOrder: exchange has no controller, fees burned');

    const existingOrder = existingOrderForFees;
    if (existingOrder) {
      const newAmount = (existingOrder.amount || 0) - this.amount;
      await this.writeComponent('Order', {
        entity: this.vars.exchange,
        crew: this.vars.buyer_crew,
        orderType: Order.IDS.LIMIT_BUY,
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

    // Remove products from seller's origin inventory
    if (this.originInv) {
      const updatedContents = (this.originInv.contents || []).map(c => {
        if (c.product === this.product) {
          return { product: c.product, amount: c.amount - this.amount };
        }
        return c;
      }).filter(c => c.amount > 0);

      let newMass = 0;
      let newVolume = 0;
      for (const c of updatedContents) {
        const cpt = Product.TYPES[c.product];
        if (cpt) { newMass += c.amount * cpt.massPerUnit; newVolume += c.amount * cpt.volumePerUnit; }
      }

      const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label || Entity.IDS.BUILDING };
      await this.writeComponent('Inventory', {
        entity: originEntity,
        inventoryType: this.originInv.inventoryType,
        slot: this.originInv.slot,
        status: this.originInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: this.originInv.reservedMass,
        reservedVolume: this.originInv.reservedVolume,
        contents: updatedContents
      });
    }

    // Add products to buyer's storage inventory and clear reservation.
    // Buyer's storage type must accept the product (e.g. you can't land
    // Steel Sheets in a Propellant Tank). Bounces with 400 otherwise.
    if (this.buyerStorageInv) {
      this._assertInventoryAccepts(this.buyerStorageInv, [{ product: this.product, amount: this.amount }]);
      const updatedContents = [...(this.buyerStorageInv.contents || [])];
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

      const buyerStorageEntity = { id: this.vars.storage.id, label: this.vars.storage.label || Entity.IDS.BUILDING };
      await this.writeComponent('Inventory', {
        entity: buyerStorageEntity,
        inventoryType: this.buyerStorageInv.inventoryType,
        slot: this.buyerStorageInv.slot,
        status: this.buyerStorageInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: Math.max(0, (this.buyerStorageInv.reservedMass || 0) - filledMass),
        reservedVolume: Math.max(0, (this.buyerStorageInv.reservedVolume || 0) - filledVolume),
        contents: updatedContents
      });
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
      origin: this.vars.origin,
      originSlot: this.originSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/BuyOrderFilled');
  }
}

module.exports = FillBuyOrderHandler;
