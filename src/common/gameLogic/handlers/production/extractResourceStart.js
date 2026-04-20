const { Deposit, Entity, Extractor, Permission } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ExtractResourceStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ResourceExtractionStarted'; }

  async validate() {
    const {
      extractor: extractorRef,
      extractor_slot: extractorSlot,
      yield: targetYield,
      deposit: depositRef,
      destination: destRef,
      destination_slot: destSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!extractorRef?.id) throw new ValidationError('vars.extractor with id is required');
    if (!depositRef?.id) throw new ValidationError('vars.deposit with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');
    if (!targetYield || targetYield <= 0) throw new ValidationError('vars.yield must be positive');

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

    // 2. Extractor building must exist
    this.extractor = await EntityService.getEntity({
      id: extractorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.extractor) throw new ValidationError('Extractor building not found');

    // 3. Must have EXTRACT_RESOURCES permission
    await AccessValidator.assertPermission(this.crew, this.extractor, Permission.IDS.EXTRACT_RESOURCES);

    // 4. Deposit must exist and be SAMPLED
    this.deposit = await EntityService.getEntity({
      id: depositRef.id,
      label: Entity.IDS.DEPOSIT,
      components: ['Deposit'],
      format: true
    });
    if (!this.deposit) throw new ValidationError('Deposit not found');
    if (this.deposit.Deposit.status !== Deposit.STATUSES.SAMPLED) {
      throw new ValidationError('Deposit must be sampled before extraction');
    }
    if (this.deposit.Deposit.remainingYield < targetYield) {
      throw new ValidationError('Target yield exceeds remaining deposit yield');
    }

    // 5. Destination must exist
    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    this.extractorSlot = Number(extractorSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
    this.targetYield = Number(targetYield);
  }

  async applyStateChanges() {
    const extractionTime = Extractor.getExtractionTime(this.targetYield, this.deposit.Deposit.remainingYield, 1);
    this.finishTime = this.now + await this.gameSecondsToReal(extractionTime);

    // Update extractor component to RUNNING
    await this.writeComponent('Extractor', {
      entity: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      slot: this.extractorSlot,
      status: Extractor.STATUSES.RUNNING,
      outputProduct: this.deposit.Deposit.resource,
      yield: this.targetYield,
      destination: { id: this.destination.id, label: this.destination.label },
      destinationSlot: this.destSlot,
      finishTime: this.finishTime
    });

    // Update deposit remaining yield
    await this.writeComponent('Deposit', {
      entity: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      status: Deposit.STATUSES.USED,
      initialYield: this.deposit.Deposit.initialYield,
      remainingYield: this.deposit.Deposit.remainingYield - this.targetYield,
      yieldEff: this.deposit.Deposit.yieldEff,
      finishTime: this.finishTime
    });

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      deposit: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      yield: this.targetYield,
      extractor: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      extractorSlot: this.extractorSlot,
      destination: { id: this.destination.id, label: this.destination.label },
      destinationSlot: this.destSlot,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ResourceExtractionStarted');
  }
}

module.exports = ExtractResourceStartHandler;
