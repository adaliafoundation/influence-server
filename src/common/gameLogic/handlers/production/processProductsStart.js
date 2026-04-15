const { Entity, Permission, Process, Processor } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class ProcessProductsStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'MaterialProcessingStarted'; }

  async validate() {
    const {
      processor: processorRef,
      processor_slot: processorSlot,
      process: processId,
      recipes,
      origin: originRef,
      origin_slot: originSlot,
      destination: destRef,
      destination_slot: destSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!processorRef?.id) throw new ValidationError('vars.processor with id is required');
    if (!processId) throw new ValidationError('vars.process is required');
    if (!recipes || recipes <= 0) throw new ValidationError('vars.recipes must be positive');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');

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

    // 2. Processor building must exist
    this.processor = await EntityService.getEntity({
      id: processorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.processor) throw new ValidationError('Processor building not found');

    // 3. Must have RUN_PROCESS permission
    await AccessValidator.assertPermission(this.crew, this.processor, Permission.IDS.RUN_PROCESS);

    // 4. Process type must be valid
    if (!Process.TYPES[processId]) throw new ValidationError('Invalid process type');

    // 5. Origin and destination must exist
    this.origin = await EntityService.getEntity({
      id: originRef.id,
      label: originRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.origin) throw new ValidationError('Origin not found');

    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    this.processId = Number(processId);
    this.recipes = Number(recipes);
    this.processorSlot = Number(processorSlot) || 1;
    this.originSlot = Number(originSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
  }

  async applyStateChanges() {
    const setupTime = Process.getSetupTime(this.processId, 1);
    const processingTime = Process.getProcessingTime(this.processId, this.recipes, 1);
    this.finishTime = this.now + Math.ceil(setupTime + processingTime);

    const outputs = Process.getOutputs(this.processId, this.recipes, 1) || [];
    const primaryOutput = outputs[0]?.product || this.vars.target_output || 0;

    // Update processor component to RUNNING
    await this.writeComponent('Processor', {
      entity: { id: this.processor.id, label: Entity.IDS.BUILDING },
      slot: this.processorSlot,
      status: Processor.STATUSES.RUNNING,
      runningProcess: this.processId,
      recipes: this.recipes,
      outputProduct: Number(primaryOutput),
      destination: { id: this.destination.id, label: this.destination.label },
      destinationSlot: this.destSlot,
      finishTime: this.finishTime
    });

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      processor: { id: this.processor.id, label: Entity.IDS.BUILDING },
      processorSlot: this.processorSlot,
      process: this.processId,
      inputs: [],
      origin: this.vars.origin,
      originSlot: this.originSlot,
      outputs: [],
      destination: this.vars.destination,
      destinationSlot: this.destSlot,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingStarted/v1');
  }
}

module.exports = ProcessProductsStartHandler;
