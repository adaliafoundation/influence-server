const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ChangeNameHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'NameChanged'; }

  async validate() {
    const { entity: entityRef, name, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!entityRef?.id || !entityRef?.label) throw new ValidationError('vars.entity with id and label is required');
    if (!name) throw new ValidationError('vars.name is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.entity = entityRef;
    this.name = name;
  }

  async applyStateChanges() {
    await this.writeComponent('Name', {
      entity: this.entity,
      name: this.name
    });
    return {};
  }

  getReturnValues() {
    return {
      entity: this.entity,
      name: this.name,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/NameChanged');
  }
}

module.exports = ChangeNameHandler;
