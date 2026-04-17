const { Delivery, Entity, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ReceiveDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliveryReceived'; }

  async validate() {
    const { delivery: deliveryRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!deliveryRef?.id) throw new ValidationError('vars.delivery with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Delivery must exist and be SENT
    this.delivery = await EntityService.getEntity({
      id: deliveryRef.id,
      label: Entity.IDS.DELIVERY,
      components: ['Delivery', 'Control'],
      format: true
    });
    if (!this.delivery) throw new ValidationError('Delivery not found');
    StateMachineValidator.assertStatus(this.delivery.Delivery, Delivery.STATUSES.SENT, 'Delivery');

    // 3. Delivery must have arrived
    StateMachineValidator.assertFinished(this.delivery.Delivery, 'Delivery');
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
      finishTime: this.delivery.Delivery.finishTime
    });

    // Add delivered products to destination inventory
    const { dest, destSlot, contents } = this.delivery.Delivery;
    const destEntity = { id: dest.id, label: dest.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    const destInv = destInventories.find((inv) => inv.slot === (destSlot || 1));
    if (destInv) {
      const updatedContents = [...(destInv.contents || [])];
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
        entity: destEntity,
        inventoryType: destInv.inventoryType,
        slot: destInv.slot,
        status: destInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: 0,
        reservedVolume: 0,
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
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryReceived');
  }
}

module.exports = ReceiveDeliveryHandler;
