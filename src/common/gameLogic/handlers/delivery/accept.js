const { Asteroid, Delivery, Entity, Product } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class AcceptDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliverySent'; }

  async validate() {
    const { delivery: deliveryRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!deliveryRef?.id) throw new ValidationError('vars.delivery with id is required');

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

    // 2. Delivery must exist and be PACKAGED
    this.delivery = await EntityService.getEntity({
      id: deliveryRef.id,
      label: Entity.IDS.DELIVERY,
      components: ['Delivery', 'Control'],
      format: true
    });
    if (!this.delivery) throw new ValidationError('Delivery not found');
    StateMachineValidator.assertStatus(this.delivery.Delivery, Delivery.STATUSES.PACKAGED, 'Delivery');

    // Load origin/dest locations so we can compute lot-based travel time
    const { origin, dest } = this.delivery.Delivery;
    this.originEntity = await EntityService.getEntity({ id: origin.id, label: origin.label, components: ['Location'], format: true });
    this.destEntity = await EntityService.getEntity({ id: dest.id, label: dest.label, components: ['Location'], format: true });
  }

  async applyStateChanges() {
    let travelSeconds = 60;
    const originLoc = this.originEntity?.Location?.location;
    const destLoc = this.destEntity?.Location?.location;
    if (originLoc?.label === Entity.IDS.LOT && destLoc?.label === Entity.IDS.LOT) {
      const originLot = EntityLib.toEntity(originLoc).unpackLot();
      const destLot = EntityLib.toEntity(destLoc).unpackLot();
      if (originLot.asteroidId === destLot.asteroidId) {
        travelSeconds = Asteroid.getLotTravelTime(originLot.asteroidId, originLot.lotIndex, destLot.lotIndex);
      }
    }
    this.finishTime = this.now + this.capDuration(travelSeconds);

    await this.writeComponent('Delivery', {
      entity: { id: this.delivery.id, label: Entity.IDS.DELIVERY },
      status: Delivery.STATUSES.SENT,
      origin: this.delivery.Delivery.origin,
      originSlot: this.delivery.Delivery.originSlot,
      dest: this.delivery.Delivery.dest,
      destSlot: this.delivery.Delivery.destSlot,
      contents: this.delivery.Delivery.contents,
      finishTime: this.finishTime
    });

    // Compute delivery mass/volume
    let deliveryMass = 0;
    let deliveryVolume = 0;
    for (const p of this.delivery.Delivery.contents) {
      const pt = Product.TYPES[p.product];
      if (pt) { deliveryMass += p.amount * pt.massPerUnit; deliveryVolume += p.amount * pt.volumePerUnit; }
    }

    // Clear origin reservation (set to 0)
    const { origin, originSlot, dest, destSlot } = this.delivery.Delivery;
    const originEntity = { id: origin.id, label: origin.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    const originInv = originInventories.find((inv) => inv.slot === (originSlot || 1));
    if (originInv) {
      await this.writeComponent('Inventory', {
        entity: originEntity,
        inventoryType: originInv.inventoryType,
        slot: originInv.slot,
        status: originInv.status,
        mass: originInv.mass,
        volume: originInv.volume,
        reservedMass: 0,
        reservedVolume: 0,
        contents: originInv.contents
      });
    }

    // Reserve space at destination inventory
    const destEntity = { id: dest.id, label: dest.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    const destInv = destInventories.find((inv) => inv.slot === (destSlot || 1));
    if (destInv) {
      await this.writeComponent('Inventory', {
        entity: destEntity,
        inventoryType: destInv.inventoryType,
        slot: destInv.slot,
        status: destInv.status,
        mass: destInv.mass,
        volume: destInv.volume,
        reservedMass: (destInv.reservedMass || 0) + deliveryMass,
        reservedVolume: (destInv.reservedVolume || 0) + deliveryVolume,
        contents: destInv.contents
      });
    }

    return { deliveryId: this.delivery.id };
  }

  getReturnValues() {
    return {
      origin: this.delivery.Delivery.origin,
      originSlot: this.delivery.Delivery.originSlot,
      products: this.delivery.Delivery.contents,
      dest: this.delivery.Delivery.dest,
      destSlot: this.delivery.Delivery.destSlot,
      delivery: { id: this.delivery.id, label: Entity.IDS.DELIVERY },
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

module.exports = AcceptDeliveryHandler;
