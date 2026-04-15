const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CollectEmergencyPropellantHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'EmergencyPropellantCollected'; }

  async validate() {
    const { caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    const crewLocation = this.crew.Location?.location;
    if (!crewLocation || crewLocation.label !== Entity.IDS.SHIP) {
      throw new ValidationError('Crew is not on a ship');
    }
    this.ship = { id: crewLocation.id, label: Entity.IDS.SHIP };
    this.amount = Number(this.vars.amount || 0);
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      ship: this.ship,
      amount: this.amount,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/EmergencyPropellantCollected');
  }
}

module.exports = CollectEmergencyPropellantHandler;
