const { Asteroid, Building, Delivery, Entity, Inventory, Permission, Product } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const IdGenerator = require('../../helpers/idGenerator');
const { ValidationError } = require('../../errors');

class SendDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliverySent'; }

  async validate() {
    const {
      origin: originRef, origin_slot: originSlot,
      dest: destRef, dest_slot: destSlot,
      products, caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.dest with id and label is required');
    if (!Array.isArray(products) || products.length === 0) throw new ValidationError('vars.products must be a non-empty array');

    this.now = Math.floor(Date.now() / 1000);

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

    // 2. Origin and destination must exist
    this.origin = await EntityService.getEntity({ id: originRef.id, label: originRef.label, components: ['Location'], format: true });
    if (!this.origin) throw new ValidationError('Origin not found');

    this.dest = await EntityService.getEntity({ id: destRef.id, label: destRef.label, components: ['Location'], format: true });
    if (!this.dest) throw new ValidationError('Destination not found');

    // 2b. Caller must have REMOVE_PRODUCTS on the origin and ADD_PRODUCTS
    // on the destination. Cairo send.cairo:104-105 enforces both — without
    // these checks a crew could siphon from any warehouse it can see and
    // dump into any inventory it can see.
    await AccessValidator.assertPermission(this.crew, this.origin, Permission.IDS.REMOVE_PRODUCTS);
    await AccessValidator.assertPermission(this.crew, this.dest, Permission.IDS.ADD_PRODUCTS);

    this.originSlot = Number(originSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
    this.products = products.map((p) => ({ product: Number(p.product), amount: Math.floor(Number(p.amount)) }));

    // 3. Origin inventory must exist and be available
    const originEntity = { id: originRef.id, label: originRef.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    this.originInv = originInventories.find((inv) => inv.slot === this.originSlot);
    if (!this.originInv) throw new ValidationError('Origin inventory not found');
    if (this.originInv.status !== Inventory.STATUSES.AVAILABLE) {
      throw new ValidationError('Origin inventory is not available');
    }

    // Origin must have enough of each product
    for (const p of this.products) {
      const available = (this.originInv.contents || []).find((c) => c.product === p.product);
      if (!available || available.amount < p.amount) {
        const name = Product.TYPES[p.product]?.name || p.product;
        throw new ValidationError(`Insufficient ${name} in origin (have ${available?.amount || 0}, need ${p.amount})`);
      }
    }

    // 4. Destination inventory must exist and be available
    const destEntity = { id: destRef.id, label: destRef.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    this.destInv = destInventories.find((inv) => inv.slot === this.destSlot);
    if (!this.destInv) throw new ValidationError('Destination inventory not found');
    if (this.destInv.status !== Inventory.STATUSES.AVAILABLE) {
      throw new ValidationError('Destination inventory is not available');
    }

    // 5. If destination is a construction site, validate material types and amounts
    const destInvType = Inventory.TYPES[this.destInv.inventoryType];
    if (destInvType?.category === Inventory.CATEGORIES.SITE) {
      // Look up the building to get its construction requirements
      const destBuilding = await EntityService.getEntity({
        id: destRef.id, label: destRef.label,
        components: ['Building'], format: true
      });
      const requirements = destBuilding
        ? Building.CONSTRUCTION_TYPES[destBuilding.Building?.buildingType]?.requirements || {}
        : {};

      for (const p of this.products) {
        const required = requirements[p.product];
        if (!required) {
          const name = Product.TYPES[p.product]?.name || p.product;
          throw new ValidationError(`${name} is not a required construction material for this building`);
        }
        const alreadyOnSite = (this.destInv.contents || []).find((c) => c.product === p.product)?.amount || 0;
        if (alreadyOnSite + p.amount > required) {
          const name = Product.TYPES[p.product]?.name || p.product;
          throw new ValidationError(`Too much ${name}: site needs ${required}, already has ${alreadyOnSite}, sending ${p.amount}`);
        }
      }
    } else {
      // Non-site destination: enforce productConstraints up-front so we
      // don't reserve space for a delivery that can never be received
      // (e.g. sending Steel to a Propellant Tank).
      this._assertInventoryAccepts(this.destInv, this.products);
    }

    // 6. Destination must have enough free mass and volume
    const capacity = Inventory.getFilledCapacity(this.destInv.inventoryType);
    const currentContents = this.destInv.contents || [];
    let usedMass = 0;
    let usedVolume = 0;
    for (const c of currentContents) {
      const pt = Product.TYPES[c.product];
      if (pt) { usedMass += c.amount * pt.massPerUnit; usedVolume += c.amount * pt.volumePerUnit; }
    }
    let addedMass = 0;
    let addedVolume = 0;
    for (const p of this.products) {
      const pt = Product.TYPES[p.product];
      if (pt) { addedMass += p.amount * pt.massPerUnit; addedVolume += p.amount * pt.volumePerUnit; }
    }
    if (usedMass + addedMass > capacity.filledMass) {
      throw new ValidationError('Destination inventory does not have enough free mass');
    }
    if (usedVolume + addedVolume > capacity.filledVolume) {
      throw new ValidationError('Destination inventory does not have enough free volume');
    }
  }

  async applyStateChanges() {
    // Compute delivery time based on lot distance (matching on-chain behaviour).
    // When origin and dest are on the same asteroid the SDK returns 0 for adjacent lots.
    let travelSeconds = 60; // fallback
    const originLoc = this.origin.Location?.location;
    const destLoc = this.dest.Location?.location;
    if (originLoc?.label === Entity.IDS.LOT && destLoc?.label === Entity.IDS.LOT) {
      const originLot = EntityLib.toEntity(originLoc).unpackLot();
      const destLot = EntityLib.toEntity(destLoc).unpackLot();
      if (originLot.asteroidId === destLot.asteroidId) {
        travelSeconds = Asteroid.getLotTravelTime(originLot.asteroidId, originLot.lotIndex, destLot.lotIndex);
      }
    }
    this.finishTime = this.now + this.capDuration(travelSeconds);

    this.deliveryId = await IdGenerator.next(Entity.IDS.DELIVERY);

    await this.createEntityWithComponents(
      { id: this.deliveryId, label: Entity.IDS.DELIVERY },
      [
        {
          component: 'Delivery',
          data: {
            status: Delivery.STATUSES.SENT,
            origin: EntityLib.toEntity(this.vars.origin).toObject(),
            originSlot: this.originSlot,
            dest: EntityLib.toEntity(this.vars.dest).toObject(),
            destSlot: this.destSlot,
            contents: this.products,
            finishTime: this.finishTime
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

    // Subtract delivered products from origin inventory
    const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label };
    const updatedContents = (this.originInv.contents || []).map((c) => {
      const sent = this.products.find((p) => p.product === c.product);
      if (!sent) return c;
      return { product: c.product, amount: c.amount - sent.amount };
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

    // Reserve space at the destination inventory
    let deliveryMass = 0;
    let deliveryVolume = 0;
    for (const p of this.products) {
      const pt = Product.TYPES[p.product];
      if (pt) { deliveryMass += p.amount * pt.massPerUnit; deliveryVolume += p.amount * pt.volumePerUnit; }
    }

    const destEntity = { id: this.vars.dest.id, label: this.vars.dest.label };
    await this.writeComponent('Inventory', {
      entity: destEntity,
      inventoryType: this.destInv.inventoryType,
      slot: this.destInv.slot,
      status: this.destInv.status,
      mass: this.destInv.mass,
      volume: this.destInv.volume,
      reservedMass: (this.destInv.reservedMass || 0) + deliveryMass,
      reservedVolume: (this.destInv.reservedVolume || 0) + deliveryVolume,
      contents: this.destInv.contents
    });

    return { deliveryId: this.deliveryId };
  }

  getReturnValues() {
    return {
      origin: this.vars.origin,
      originSlot: this.originSlot,
      products: this.products,
      dest: this.vars.dest,
      destSlot: this.destSlot,
      delivery: { id: this.deliveryId, label: Entity.IDS.DELIVERY },
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliverySent');
  }
}

module.exports = SendDeliveryHandler;
