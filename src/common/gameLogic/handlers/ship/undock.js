const { Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ShipUndockHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipUndocked'; }

  async validate() {
    const { ship: shipRef, caller_crew: callerCrewRef } = this.vars || {};
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

    // 2. Find the ship - either from vars or from crew's location chain
    if (shipRef?.id) {
      this.ship = await EntityService.getEntity({
        id: shipRef.id,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Location', 'Control'],
        format: true
      });
    } else {
      const crewLocation = this.crew.Location?.location;
      if (crewLocation?.label === Entity.IDS.SHIP) {
        this.ship = await EntityService.getEntity({
          id: crewLocation.id,
          label: Entity.IDS.SHIP,
          components: ['Ship', 'Location', 'Control'],
          format: true
        });
      }
    }
    if (!this.ship) throw new ValidationError('Ship not found');

    // 3. Ship must be docked (its location is a building)
    const shipLocation = this.ship.Location?.location;
    if (!shipLocation || shipLocation.label !== Entity.IDS.BUILDING) {
      throw new ValidationError('Ship is not docked at a building');
    }
    this.dock = shipLocation;
  }

  async applyStateChanges() {
    // Move ship to the asteroid (undock from building to orbit)
    const locations = this.ship.Location?.locations || [];
    const asteroid = locations.find((l) => l.label === Entity.IDS.ASTEROID);
    if (!asteroid) throw new ValidationError('Cannot determine asteroid for undocking');

    await this.writeComponent('Location', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      location: asteroid,
      locations: [asteroid]
    });

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      dock: this.dock,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipUndocked');
  }
}

module.exports = ShipUndockHandler;
