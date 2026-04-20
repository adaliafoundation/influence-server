const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
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
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    // Dump just destroys the cargo - no entity to create or update
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
