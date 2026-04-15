const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CrewArrangeHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'CrewmatesArranged'; }

  async validate() {
    const { composition, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!Array.isArray(composition) || composition.length === 0) {
      throw new ValidationError('vars.composition must be a non-empty array');
    }

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. New composition must contain the same crewmates as the current roster
    this.oldRoster = this.crew.Crew?.roster || [];
    const newSet = new Set(composition.map(Number));
    const oldSet = new Set(this.oldRoster.map(Number));
    if (newSet.size !== oldSet.size || ![...newSet].every((id) => oldSet.has(id))) {
      throw new ValidationError('New composition must contain the same crewmates as the current roster');
    }
  }

  async applyStateChanges() {
    const newRoster = this.vars.composition.map(Number);

    await this.writeComponent('Crew', {
      entity: { id: this.crew.id, label: Entity.IDS.CREW },
      roster: newRoster,
      lastFed: this.crew.Crew.lastFed,
      readyAt: this.crew.Crew.readyAt,
      delegatedTo: this.crew.Crew.delegatedTo
    });

    return { crewId: this.crew.id };
  }

  getReturnValues() {
    return {
      compositionOld: this.oldRoster,
      compositionNew: this.vars.composition.map(Number),
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewmatesArranged/v1');
  }
}

module.exports = CrewArrangeHandler;
