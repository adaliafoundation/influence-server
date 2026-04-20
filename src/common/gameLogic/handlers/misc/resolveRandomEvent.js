const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ResolveRandomEventHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'RandomEventResolved'; }

  async validate() {
    const { choice, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (choice === undefined) throw new ValidationError('vars.choice is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.choice = Number(choice);
    // These may be provided by the client or default to 0
    this.randomEvent = Number(this.vars.random_event || 0);
    this.actionType = Number(this.vars.action_type || 0);
    this.actionTarget = this.vars.action_target || { id: 0, label: 0 };
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      randomEvent: this.randomEvent,
      choice: this.choice,
      actionType: this.actionType,
      actionTarget: this.actionTarget,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/RandomEventResolved');
  }
}

module.exports = ResolveRandomEventHandler;
