const { Deposit, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const IdGenerator = require('../../helpers/idGenerator');
const { ValidationError } = require('../../errors');

class SampleDepositStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SamplingDepositStarted'; }

  async validate() {
    const { resource, lot: lotRef, origin: originRef, origin_slot: originSlot, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!lotRef?.id) throw new ValidationError('vars.lot with id is required');
    if (!resource) throw new ValidationError('vars.resource is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (originSlot === undefined || originSlot === null) throw new ValidationError('vars.origin_slot is required');

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

    // 2. Lot must exist
    this.lot = await EntityService.getEntity({
      id: lotRef.id,
      label: Entity.IDS.LOT,
      components: ['Location'],
      format: true
    });
    if (!this.lot) throw new ValidationError('Lot not found');

    // 3. Origin (inventory source for core drill) must exist
    this.origin = await EntityService.getEntity({
      id: originRef.id,
      label: originRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.origin) throw new ValidationError('Origin not found');
  }

  async applyStateChanges() {
    const sampleTime = Deposit.getSampleTime(1);
    this.finishTime = this.now + await this.gameSecondsToReal(sampleTime);

    // Generate a new deposit ID
    this.depositId = await IdGenerator.next(Entity.IDS.DEPOSIT);

    const lotEntity = EntityLib.toEntity(this.vars.lot);
    const fullLocation = await LocationComponentService.getFullLocation(lotEntity);

    // Create the deposit entity with components
    await this.createEntityWithComponents(
      { id: this.depositId, label: Entity.IDS.DEPOSIT },
      [
        {
          component: 'Deposit',
          data: {
            resource: Number(this.vars.resource),
            status: Deposit.STATUSES.SAMPLING,
            initialYield: 0,
            remainingYield: 0,
            yieldEff: 0,
            finishTime: this.finishTime
          }
        },
        {
          component: 'Control',
          data: {
            controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
          }
        },
        {
          component: 'Location',
          data: {
            location: lotEntity.toObject(),
            locations: fullLocation
          }
        }
      ]
    );

    return { depositId: this.depositId, finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      deposit: { id: this.depositId, label: Entity.IDS.DEPOSIT },
      lot: this.vars.lot,
      resource: Number(this.vars.resource),
      improving: false,
      origin: this.vars.origin,
      originSlot: Number(this.vars.origin_slot),
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SamplingDepositStarted/v1');
  }
}

module.exports = SampleDepositStartHandler;
