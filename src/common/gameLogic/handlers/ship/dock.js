const { Asteroid, Dock, Entity, Permission, Product, Ship } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ShipDockHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipDocked'; }

  async validate() {
    const { target: dockRef, powered, caller_crew: callerCrewRef } = this.vars || {};
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
      components: ['Ship', 'Location', 'Control', 'Inventory'],
      format: true
    });
    if (!this.ship) throw new ValidationError('Ship not found');

    // 2b. Ship must be in orbit (location points to asteroid, not a building)
    const shipLocation = this.ship.Location?.location;
    if (shipLocation && shipLocation.label === Entity.IDS.BUILDING) {
      throw new ValidationError('Ship is already docked');
    }

    this.now = Math.floor(Date.now() / 1000);

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

    // 4b. If docking at a building, check dock capacity
    if (dockRef.label === Entity.IDS.BUILDING) {
      this.dockData = await ComponentService.findOne('Dock', {
        'entity.id': dockRef.id, 'entity.label': dockRef.label
      });
      if (this.dockData) {
        const dockConfig = Dock.TYPES[this.dockData.dockType];
        if (dockConfig && this.dockData.dockedShips >= dockConfig.cap) {
          throw new ValidationError('Dock is at capacity');
        }
      }
    }

    // 5. If propulsive landing, validate propellant
    this.powered = !!powered;
    if (this.powered) {
      // Find the asteroid from the ship's current location
      const locations = this.ship.Location?.locations || [];
      const asteroidLoc = locations.find((l) => l.label === Entity.IDS.ASTEROID)
        || this.ship.Location?.location;
      if (!asteroidLoc || asteroidLoc.label !== Entity.IDS.ASTEROID) {
        throw new ValidationError('Cannot determine asteroid for landing');
      }

      this.asteroid = await EntityService.getEntity({
        id: asteroidLoc.id,
        label: Entity.IDS.ASTEROID,
        components: ['Celestial'],
        format: true
      });
      if (!this.asteroid) throw new ValidationError('Asteroid not found');

      const escapeVelocity = Asteroid.Entity.getEscapeVelocity(this.asteroid) * 1000; // km/s → m/s
      this.propellantRequired = Ship.Entity.getPropellantRequirement(this.ship, escapeVelocity);

      // Find propellant inventory
      const shipConfig = Ship.TYPES[this.ship.Ship.shipType];
      const shipEntity = { id: this.ship.id, label: Entity.IDS.SHIP };
      const inventories = await ComponentService.findByEntity('Inventory', shipEntity);
      this.propellantInv = inventories.find((inv) => inv.slot === shipConfig.propellantSlot);
      if (!this.propellantInv) throw new ValidationError('Ship has no propellant tank');

      // Check there's enough propellant
      const currentMass = this.propellantInv.mass || 0;
      if (currentMass < this.propellantRequired) {
        throw new ValidationError('Insufficient propellant for powered landing');
      }
    }
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

    // Increment docked ships count if docking at a building with a Dock component
    if (this.dockData) {
      await this.writeComponent('Dock', {
        entity: { id: this.dock.id, label: this.dock.label },
        dockType: this.dockData.dockType,
        dockedShips: this.dockData.dockedShips + 1
      });
    }

    // Set crew busy for docking procedure (skip if powered — propellant landing is instant)
    if (!this.powered) {
      await this.setCrewBusy(this.crew, this.now + this.capDuration(60));
    }

    // Deduct propellant if powered landing
    if (this.powered && this.propellantInv) {
      const propellantProduct = Ship.TYPES[this.ship.Ship.shipType].propellantType;
      const pt = Product.TYPES[propellantProduct];
      const unitsToDeduct = Math.ceil(this.propellantRequired / pt.massPerUnit);

      const updatedContents = (this.propellantInv.contents || []).map((c) => {
        if (c.product !== propellantProduct) return c;
        return { product: c.product, amount: c.amount - unitsToDeduct };
      }).filter((c) => c.amount > 0);

      let newMass = 0;
      let newVolume = 0;
      for (const c of updatedContents) {
        const cpt = Product.TYPES[c.product];
        if (cpt) { newMass += c.amount * cpt.massPerUnit; newVolume += c.amount * cpt.volumePerUnit; }
      }

      const shipEntity = { id: this.ship.id, label: Entity.IDS.SHIP };
      await this.writeComponent('Inventory', {
        entity: shipEntity,
        inventoryType: this.propellantInv.inventoryType,
        slot: this.propellantInv.slot,
        status: this.propellantInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: this.propellantInv.reservedMass,
        reservedVolume: this.propellantInv.reservedVolume,
        contents: updatedContents
      });
    }

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
