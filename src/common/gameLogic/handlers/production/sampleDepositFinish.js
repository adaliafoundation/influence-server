const { Asteroid, Crew, Crewmate, Deposit, Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
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
      components: ['Deposit', 'Control', 'Location'],
      format: true
    });
    if (!this.deposit) throw new ValidationError('Deposit not found');
    StateMachineValidator.assertStatus(this.deposit.Deposit, Deposit.STATUSES.SAMPLING, 'Deposit');

    // 3. Sampling must be finished
    StateMachineValidator.assertFinished(this.deposit.Deposit, 'Deposit sampling');

    // 4. Load asteroid to get real resource abundance
    const locations = this.deposit.Location?.locations || [];
    const asteroidLoc = locations.find((l) => l.label === Entity.IDS.ASTEROID);
    if (asteroidLoc) {
      this.asteroid = await EntityService.getEntity({
        id: asteroidLoc.id,
        label: Entity.IDS.ASTEROID,
        components: ['Celestial'],
        format: true
      });
    }

    // 5. Load crewmate docs so we can compute the real CORE_SAMPLE_QUALITY
    // bonus (Cairo applies a 0.5× penalty when the crew has no Miner). The
    // SDK's Crew.getAbilityBonus needs the crewmate docs as input.
    const roster = this.crew.Crew?.roster || [];
    if (roster.length) {
      this.crewmates = await Promise.all(roster.map(
        (cmId) => ComponentService.findOne('Crewmate', { 'entity.id': cmId, 'entity.label': Entity.IDS.CREWMATE })
      ));
      this.crewmates = this.crewmates.filter(Boolean);
    } else {
      this.crewmates = [];
    }
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
    // Get real abundance from the asteroid's Celestial component
    let abundance = 0.5;
    if (this.asteroid) {
      const abundances = Asteroid.Entity.getAbundances(this.asteroid);
      const resourceAbundance = abundances[this.deposit.Deposit.resource];
      if (resourceAbundance !== undefined) abundance = resourceAbundance;
    }

    // CORE_SAMPLE_QUALITY bonus from the crew — 0.5× penalty when no miner
    // (matches Cairo sample_finish which applies the crew_sample ability).
    const qualityBonus = Crew.getAbilityBonus(
      Crewmate.ABILITY_IDS.CORE_SAMPLE_QUALITY,
      this.crewmates || []
    ).totalBonus || 1;

    // getSampleBounds works in SDK scale (max 10B). Stored yields are 1000x smaller
    // (the client passes storedYield * 1e3 when calling getSampleBounds).
    const previousYield = (this.deposit.Deposit.initialYield || 0) * 1000;
    const bounds = Deposit.getSampleBounds(abundance, previousYield, qualityBonus);
    const seed = (this.deposit.id * 2654435761) >>> 0;
    const ratio = (seed % 1000) / 1000;
    const range = Number(bounds.upper) - Number(bounds.lower);
    return Math.floor((Number(bounds.lower) + ratio * range) / 1000);
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SamplingDepositFinished');
  }
}

module.exports = SampleDepositFinishHandler;
