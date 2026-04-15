const { Delivery, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService } = require('@common/services');
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

    this.originSlot = Number(originSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
    this.products = products.map((p) => ({ product: Number(p.product), amount: Math.floor(Number(p.amount)) }));
  }

  async applyStateChanges() {
    // Simple fixed delivery time for local mode
    this.finishTime = this.now + 60;

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
