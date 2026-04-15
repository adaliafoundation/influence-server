const { Deposit, Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class SampleDepositFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SamplingDepositFinished'; }

  async validate() {
    const { deposit: depositRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!depositRef?.id) throw new ValidationError('vars.deposit with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Deposit must exist and be SAMPLING
    this.deposit = await EntityService.getEntity({
      id: depositRef.id,
      label: Entity.IDS.DEPOSIT,
      components: ['Deposit', 'Control'],
      format: true
    });
    if (!this.deposit) throw new ValidationError('Deposit not found');
    StateMachineValidator.assertStatus(this.deposit.Deposit, Deposit.STATUSES.SAMPLING, 'Deposit');

    // 3. Sampling must be finished
    StateMachineValidator.assertFinished(this.deposit.Deposit, 'Deposit sampling');
  }

  async applyStateChanges() {
    // Generate a yield based on the deposit's resource and a pseudo-random seed
    this.initialYield = this._generateYield();

    await this.writeComponent('Deposit', {
      entity: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      status: Deposit.STATUSES.SAMPLED,
      initialYield: this.initialYield,
      remainingYield: this.initialYield,
      yieldEff: 1000,
      finishTime: 0
    });

    return { initialYield: this.initialYield };
  }

  getReturnValues() {
    return {
      deposit: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      initialYield: this.initialYield,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  _generateYield() {
    // Generate a pseudo-random yield using deposit ID as seed.
    // Uses the SDK's getSampleBounds to stay within realistic ranges.
    // abundance=0.5 and totalBonus=1 give a mid-range yield.
    const bounds = Deposit.getSampleBounds(0.5, 0, 1);
    const seed = (this.deposit.id * 2654435761) >>> 0;
    const ratio = (seed % 1000) / 1000;
    const range = Number(bounds.upper) - Number(bounds.lower);
    return Math.floor(Number(bounds.lower) + ratio * range);
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SamplingDepositFinished');
  }
}

module.exports = SampleDepositFinishHandler;
