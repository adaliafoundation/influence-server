const { Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class TransitFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'TransitFinished'; }

  async validate() {
    const { caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Find the ship the crew is on
    const crewLocation = this.crew.Location?.location;
    if (!crewLocation || crewLocation.label !== Entity.IDS.SHIP) {
      throw new ValidationError('Crew is not on a ship');
    }

    this.ship = await EntityService.getEntity({
      id: crewLocation.id,
      label: Entity.IDS.SHIP,
      components: ['Ship', 'Location', 'Control'],
      format: true
    });
    if (!this.ship) throw new ValidationError('Ship not found');

    // 3. Ship must be in transit (has transitArrival set)
    if (!this.ship.Ship.transitArrival) {
      throw new ValidationError('Ship is not in transit');
    }

    // 4. Transit must be finished
    const now = Math.floor(Date.now() / 1000);
    if (this.ship.Ship.transitArrival > now) {
      throw new ValidationError('Transit not finished yet');
    }
  }

  async applyStateChanges() {
    // Clear transit data
    await this.writeComponent('Ship', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      shipType: this.ship.Ship.shipType,
      status: this.ship.Ship.status,
      variant: this.ship.Ship.variant,
      readyAt: 0,
      emergencyAt: this.ship.Ship.emergencyAt,
      transitDeparture: 0,
      transitArrival: 0,
      transitOrigin: this.ship.Ship.transitDestination,
      transitDestination: this.ship.Ship.transitDestination
    });

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      origin: this.ship.Ship.transitOrigin,
      destination: this.ship.Ship.transitDestination,
      departure: this.ship.Ship.transitDeparture,
      arrival: this.ship.Ship.transitArrival,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/TransitFinished');
  }
}

module.exports = TransitFinishHandler;
