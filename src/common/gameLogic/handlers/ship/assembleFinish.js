const { Entity, Ship } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class AssembleShipFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipAssemblyFinished'; }

  async validate() {
    const { dry_dock: dryDockRef, dry_dock_slot: dryDockSlot, destination: destRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!dryDockRef?.id) throw new ValidationError('vars.dry_dock with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Dry dock must exist
    this.dryDock = await EntityService.getEntity({
      id: dryDockRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.dryDock) throw new ValidationError('Dry dock not found');

    this.dryDockSlot = Number(dryDockSlot) || 1;

    // 3. Find the ship being assembled at this dry dock
    const shipLocation = await ComponentService.findOne('Location', {
      'location.id': dryDockRef.id,
      'location.label': Entity.IDS.BUILDING,
      'entity.label': Entity.IDS.SHIP
    });
    if (!shipLocation) throw new ValidationError('No ship found at dry dock');

    this.ship = await EntityService.getEntity({
      id: shipLocation.entity.id,
      label: Entity.IDS.SHIP,
      components: ['Ship', 'Location', 'Control'],
      format: true
    });
    if (!this.ship) throw new ValidationError('Ship not found');
    if (this.ship.Ship.status !== Ship.STATUSES.UNDER_CONSTRUCTION) {
      throw new ValidationError('Ship is not under construction');
    }

    this.destination = destRef || { id: this.dryDock.id, label: Entity.IDS.BUILDING };
  }

  async applyStateChanges() {
    // Set ship to AVAILABLE
    await this.writeComponent('Ship', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      shipType: this.ship.Ship.shipType,
      status: Ship.STATUSES.AVAILABLE,
      variant: this.ship.Ship.variant,
      readyAt: 0,
      emergencyAt: 0,
      transitDeparture: 0,
      transitArrival: 0
    });

    // Move ship to destination if specified
    if (this.destination) {
      const destEntity = EntityLib.toEntity(this.destination);
      const fullLocation = await LocationComponentService.getFullLocation(destEntity);
      await this.writeComponent('Location', {
        entity: { id: this.ship.id, label: Entity.IDS.SHIP },
        location: destEntity.toObject(),
        locations: fullLocation
      });
    }

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      dryDock: { id: this.dryDock.id, label: Entity.IDS.BUILDING },
      dryDockSlot: this.dryDockSlot,
      destination: this.destination,
      finishTime: 0,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipAssemblyFinished');
  }
}

module.exports = AssembleShipFinishHandler;
