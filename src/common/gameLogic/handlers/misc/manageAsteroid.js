const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ManageAsteroidHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'AsteroidManaged'; }

  async validate() {
    const { asteroid: asteroidRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.asteroid = { id: asteroidRef.id, label: Entity.IDS.ASTEROID };
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      asteroid: this.asteroid,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidManaged');
  }
}

module.exports = ManageAsteroidHandler;
