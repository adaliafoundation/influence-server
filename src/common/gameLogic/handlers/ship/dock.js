const { Entity, Permission } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ShipDockHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipDocked'; }

  async validate() {
    const { target: dockRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!dockRef?.id || !dockRef?.label) throw new ValidationError('vars.target with id and label is required');

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

    // 3. Dock target must exist
    this.dock = await EntityService.getEntity({
      id: dockRef.id,
      label: dockRef.label,
      components: ['Location', 'Control'],
      format: true
    });
    if (!this.dock) throw new ValidationError('Dock target not found');

    // 4. Must have DOCK_SHIP permission on the dock
    await AccessValidator.assertPermission(this.crew, this.dock, Permission.IDS.DOCK_SHIP);
  }

  async applyStateChanges() {
    // Move ship to the dock's location
    const dockEntity = EntityLib.toEntity({ id: this.dock.id, label: this.dock.label });
    const fullLocation = await LocationComponentService.getFullLocation(dockEntity);

    await this.writeComponent('Location', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      location: dockEntity.toObject(),
      locations: fullLocation
    });

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      dock: { id: this.dock.id, label: this.dock.label },
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipDocked');
  }
}

module.exports = ShipDockHandler;
