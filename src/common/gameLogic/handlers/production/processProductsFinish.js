const { Entity, Processor } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ProcessProductsFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'MaterialProcessingFinished'; }

  async validate() {
    const { processor: processorRef, processor_slot: processorSlot, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!processorRef?.id) throw new ValidationError('vars.processor with id is required');

    this.processorSlot = Number(processorSlot) || 1;

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Processor building must exist
    this.processor = await EntityService.getEntity({
      id: processorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.processor) throw new ValidationError('Processor building not found');

    // 3. Find the processor component for this slot
    this.processorComponent = await ComponentService.findOne('Processor', {
      'entity.id': processorRef.id,
      'entity.label': Entity.IDS.BUILDING,
      slot: this.processorSlot
    });
    if (!this.processorComponent) throw new ValidationError('Processor slot not found');
    if (this.processorComponent.status !== Processor.STATUSES.RUNNING) {
      throw new ValidationError('Processor is not running');
    }

    // 4. Processing must be finished
    const now = Math.floor(Date.now() / 1000);
    if (this.processorComponent.finishTime > now) {
      throw new ValidationError('Processing not finished yet');
    }
  }

  async applyStateChanges() {
    // Set processor back to IDLE
    await this.writeComponent('Processor', {
      entity: { id: this.processor.id, label: Entity.IDS.BUILDING },
      slot: this.processorSlot,
      status: Processor.STATUSES.IDLE,
      runningProcess: 0,
      recipes: 0,
      outputProduct: 0,
      destination: this.processorComponent.destination,
      destinationSlot: this.processorComponent.destinationSlot,
      finishTime: 0
    });

    return { processorId: this.processor.id };
  }

  getReturnValues() {
    return {
      processor: { id: this.processor.id, label: Entity.IDS.BUILDING },
      processorSlot: this.processorSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingFinished');
  }
}

module.exports = ProcessProductsFinishHandler;
