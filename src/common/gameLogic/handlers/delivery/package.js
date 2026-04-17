const { Delivery, Entity, Product } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const IdGenerator = require('../../helpers/idGenerator');
const { ValidationError } = require('../../errors');

class PackageDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliveryPackaged'; }

  async validate() {
    const {
      origin: originRef, origin_slot: originSlot,
      dest: destRef, dest_slot: destSlot,
      products, price, caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.dest with id and label is required');
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
    CrewValidator.assertReady(this.crew);

    this.originSlot = Number(originSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
    this.price = Number(price) || 0;
    this.products = products.map((p) => ({ product: Number(p.product), amount: Math.floor(Number(p.amount)) }));
  }

  async applyStateChanges() {
    this.deliveryId = await IdGenerator.next(Entity.IDS.DELIVERY);

    await this.createEntityWithComponents(
      { id: this.deliveryId, label: Entity.IDS.DELIVERY },
      [
        {
          component: 'Delivery',
          data: {
            status: Delivery.STATUSES.PACKAGED,
            origin: EntityLib.toEntity(this.vars.origin).toObject(),
            originSlot: this.originSlot,
            dest: EntityLib.toEntity(this.vars.dest).toObject(),
            destSlot: this.destSlot,
            contents: this.products,
            finishTime: 0
          }
        },
        {
          component: 'Control',
          data: {
            controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
          }
        }
      ]
    );

    // Remove products from origin inventory
    const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    const originInv = originInventories.find((inv) => inv.slot === this.originSlot);
    if (originInv) {
      const updatedContents = [...(originInv.contents || [])];
      for (const item of this.products) {
        const existing = updatedContents.find((c) => c.product === item.product);
        if (existing) existing.amount -= item.amount;
      }
      const filtered = updatedContents.filter((c) => c.amount > 0);

      let newMass = 0;
      let newVolume = 0;
      for (const c of filtered) {
        const pt = Product.TYPES[c.product];
        if (pt) { newMass += c.amount * pt.massPerUnit; newVolume += c.amount * pt.volumePerUnit; }
      }

      await this.writeComponent('Inventory', {
        entity: originEntity,
        inventoryType: originInv.inventoryType,
        slot: originInv.slot,
        status: originInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: originInv.reservedMass,
        reservedVolume: originInv.reservedVolume,
        contents: filtered
      });
    }

    return { deliveryId: this.deliveryId };
  }

  getReturnValues() {
    return {
      origin: this.vars.origin,
      originSlot: this.originSlot,
      products: this.products,
      dest: this.vars.dest,
      destSlot: this.destSlot,
      price: this.price,
      delivery: { id: this.deliveryId, label: Entity.IDS.DELIVERY },
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryPackaged/v1');
  }
}

module.exports = PackageDeliveryHandler;
