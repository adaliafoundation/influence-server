const { Entity } = require('@influenceth/sdk');
const { EntityService, ComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class DeactivateEmergencyHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'EmergencyDeactivated'; }

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
  }

  async applyStateChanges() {
    // Read the current Ship component and clear emergencyAt
    const shipDoc = await ComponentService.findOneByEntity('Ship', this.ship);
    if (!shipDoc) throw new ValidationError('Ship component not found');

    await this.writeComponent('Ship', {
      entity: this.ship,
      emergencyAt: 0,
      shipType: shipDoc.shipType,
      status: shipDoc.status,
      variant: shipDoc.variant,
      readyAt: shipDoc.readyAt || 0,
      transitArrival: shipDoc.transitArrival || 0,
      transitDeparture: shipDoc.transitDeparture || 0
    });
    return {};
  }

  getReturnValues() {
    return {
      ship: this.ship,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/EmergencyDeactivated');
  }
}

module.exports = DeactivateEmergencyHandler;
