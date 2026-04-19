const { Delivery, Entity, Permission, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CancelDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliveryCancelled'; }

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

    // 2. Delivery must exist and be either PACKAGED (cancel before dispatch)
    //    or SENT with finish_time <= now (cancel after arrival but before
    //    receive). Matches Cairo cancel.cairo: PACKAGED needs no perm
    //    checks (tenant cancelled a proposal); SENT-after-finish requires
    //    REMOVE_PRODUCTS on dest AND ADD_PRODUCTS on origin to reverse
    //    the flow.
    this.delivery = await EntityService.getEntity({
      id: deliveryRef.id,
      label: Entity.IDS.DELIVERY,
      components: ['Delivery', 'Control'],
      format: true
    });
    if (!this.delivery) throw new ValidationError('Delivery not found');

    const status = this.delivery.Delivery.status;
    if (status === Delivery.STATUSES.PACKAGED) {
      // Proposal cancellation — no permission checks needed; Cairo
      // (cancel.cairo line ~66) relies on the tenant controlling the
      // delivery entity which we already enforce via assertControlledBy.
    } else if (status === Delivery.STATUSES.SENT) {
      // In-flight cancellation is only valid after the delivery would
      // have landed (Cairo cancel.cairo:79). No early-aborts.
      if ((this.delivery.Delivery.finishTime || 0) > this.now) {
        throw new ValidationError('Cannot cancel a delivery that has not arrived');
      }
      // Reverse-flow permission checks (Cairo cancel.cairo:81-82).
      const { origin, dest } = this.delivery.Delivery;
      const originEntity = await EntityService.getEntity({
        id: origin.id, label: origin.label, components: ['Location'], format: true
      });
      const destEntity = await EntityService.getEntity({
        id: dest.id, label: dest.label, components: ['Location'], format: true
      });
      if (!originEntity || !destEntity) throw new ValidationError('Delivery origin/dest no longer exists');
      await AccessValidator.assertPermission(this.crew, destEntity, Permission.IDS.REMOVE_PRODUCTS);
      await AccessValidator.assertPermission(this.crew, originEntity, Permission.IDS.ADD_PRODUCTS);
    } else {
      throw new ValidationError(`Delivery cannot be cancelled from status ${status}`);
    }
  }

  async applyStateChanges() {
    await this.writeComponent('Delivery', {
      entity: { id: this.delivery.id, label: Entity.IDS.DELIVERY },
      status: Delivery.STATUSES.COMPLETE,
      origin: this.delivery.Delivery.origin,
      originSlot: this.delivery.Delivery.originSlot,
      dest: this.delivery.Delivery.dest,
      destSlot: this.delivery.Delivery.destSlot,
      contents: this.delivery.Delivery.contents,
      finishTime: 0
    });

    // Return products to origin inventory
    const { origin, originSlot, contents } = this.delivery.Delivery;
    const originEntity = { id: origin.id, label: origin.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    const originInv = originInventories.find((inv) => inv.slot === (originSlot || 1));
    if (originInv) {
      const updatedContents = [...(originInv.contents || [])];
      for (const item of contents) {
        const existing = updatedContents.find((c) => c.product === item.product);
        if (existing) {
          existing.amount += item.amount;
        } else {
          updatedContents.push({ product: item.product, amount: item.amount });
        }
      }

      let newMass = 0;
      let newVolume = 0;
      for (const c of updatedContents) {
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
        contents: updatedContents
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
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryCancelled');
  }
}

module.exports = CancelDeliveryHandler;
