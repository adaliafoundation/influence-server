const { Entity, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class DumpDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliveryDumped'; }

  async validate() {
    const { origin: originRef, origin_slot: originSlot, products, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (!Array.isArray(products) || products.length === 0) throw new ValidationError('vars.products must be a non-empty array');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.originSlot = Number(originSlot) || 1;
    this.products = products.map((p) => ({ product: Number(p.product), amount: Math.floor(Number(p.amount)) }));

    // Validate origin inventory has enough of each product
    const originEntity = { id: originRef.id, label: originRef.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    this.originInv = originInventories.find((inv) => inv.slot === this.originSlot);
    if (!this.originInv) throw new ValidationError('Origin inventory not found');
    for (const p of this.products) {
      const available = (this.originInv.contents || []).find((c) => c.product === p.product);
      if (!available || available.amount < p.amount) {
        const name = Product.TYPES[p.product]?.name || p.product;
        throw new ValidationError(`Insufficient ${name} in origin (have ${available?.amount || 0}, need ${p.amount})`);
      }
    }
  }

  async applyStateChanges() {
    // Subtract dumped products from origin inventory
    const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label };
    const updatedContents = (this.originInv.contents || []).map((c) => {
      const dumped = this.products.find((p) => p.product === c.product);
      if (!dumped) return c;
      return { product: c.product, amount: c.amount - dumped.amount };
    }).filter((c) => c.amount > 0);

    let newMass = 0;
    let newVolume = 0;
    for (const c of updatedContents) {
      const pt = Product.TYPES[c.product];
      if (pt) { newMass += c.amount * pt.massPerUnit; newVolume += c.amount * pt.volumePerUnit; }
    }

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

    return {};
  }

  getReturnValues() {
    return {
      origin: this.vars.origin,
      originSlot: this.originSlot,
      products: this.products,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryDumped');
  }
}

module.exports = DumpDeliveryHandler;
