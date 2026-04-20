const { Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class TransitStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'TransitStarted'; }

  async validate() {
    const {
      origin: originRef,
      destination: destRef,
      departure_time: departureTime,
      arrival_time: arrivalTime,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');
    if (!departureTime) throw new ValidationError('vars.departure_time is required');
    if (!arrivalTime) throw new ValidationError('vars.arrival_time is required');

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

    // 2. Find the ship the crew is on (crew's station should be a ship)
    const crewLocation = this.crew.Location?.location;
    if (!crewLocation) throw new ValidationError('Crew has no location');

    // The crew may be on a ship or the ship may be passed in vars
    if (this.vars.ship) {
      this.ship = await EntityService.getEntity({
        id: this.vars.ship.id,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Location', 'Control'],
        format: true
      });
    } else if (crewLocation.label === Entity.IDS.SHIP) {
      this.ship = await EntityService.getEntity({
        id: crewLocation.id,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Location', 'Control'],
        format: true
      });
    }
    if (!this.ship) throw new ValidationError('Ship not found');

    // 3. Origin and destination must exist
    this.origin = originRef || this.ship.Location?.location;
    if (!this.origin) throw new ValidationError('Could not determine origin');

    this.destination = destRef;
    this.departureTime = Number(departureTime);
    this.arrivalTime = Number(arrivalTime);

    // Cap transit duration in fast-action mode
    const maxDuration = this.capDuration(this.arrivalTime - this.now);
    this.arrivalTime = this.now + maxDuration;
  }

  async applyStateChanges() {
    // Update ship's transit data
    await this.writeComponent('Ship', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      shipType: this.ship.Ship.shipType,
      status: this.ship.Ship.status,
      variant: this.ship.Ship.variant,
      readyAt: this.ship.Ship.readyAt,
      emergencyAt: this.ship.Ship.emergencyAt,
      transitDeparture: this.departureTime,
      transitArrival: this.arrivalTime,
      transitOrigin: this.origin,
      transitDestination: this.destination
    });

    // Update ship's location to the destination (in-transit)
    const destEntity = EntityLib.toEntity(this.destination);
    const fullLocation = await LocationComponentService.getFullLocation(destEntity);
    await this.writeComponent('Location', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      location: destEntity.toObject(),
      locations: fullLocation
    });

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      origin: this.origin,
      destination: this.destination,
      departure: this.departureTime,
      arrival: this.arrivalTime,
      finishTime: this.arrivalTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/TransitStarted');
  }
}

module.exports = TransitStartHandler;
