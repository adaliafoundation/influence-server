const { Delivery, Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class CancelDeliveryHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DeliveryCancelled'; }

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

    // 2. Delivery must exist and be PACKAGED (can only cancel proposals)
    this.delivery = await EntityService.getEntity({
      id: deliveryRef.id,
      label: Entity.IDS.DELIVERY,
      components: ['Delivery', 'Control'],
      format: true
    });
    if (!this.delivery) throw new ValidationError('Delivery not found');
    StateMachineValidator.assertStatus(this.delivery.Delivery, Delivery.STATUSES.PACKAGED, 'Delivery');
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
