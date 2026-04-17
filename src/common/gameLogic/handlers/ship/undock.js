const { Asteroid, Dock, Entity, Product, Ship } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ShipUndockHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipUndocked'; }

  async validate() {
    const { ship: shipRef, powered, caller_crew: callerCrewRef } = this.vars || {};
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
        components: ['Ship', 'Location', 'Control', 'Inventory'],
        format: true
      });
    } else {
      const crewLocation = this.crew.Location?.location;
      if (crewLocation?.label === Entity.IDS.SHIP) {
        this.ship = await EntityService.getEntity({
          id: crewLocation.id,
          label: Entity.IDS.SHIP,
          components: ['Ship', 'Location', 'Control', 'Inventory'],
          format: true
        });
      }
    }
    if (!this.ship) throw new ValidationError('Ship not found');

    // 3. Ship must be on a surface (docked at a building or landed on a lot)
    const shipLocation = this.ship.Location?.location;
    if (!shipLocation
      || (shipLocation.label !== Entity.IDS.BUILDING && shipLocation.label !== Entity.IDS.LOT)) {
      throw new ValidationError('Ship is not on a surface');
    }
    this.dock = shipLocation;
    this.originalLocation = shipLocation;
    this.now = Math.floor(Date.now() / 1000);

    // 4. If propulsive launch, validate propellant
    this.powered = !!powered;
    if (this.powered) {
      // Find the asteroid to compute escape velocity
      const locations = this.ship.Location?.locations || [];
      let asteroidLoc = locations.find((l) => l.label === Entity.IDS.ASTEROID);
      // If landed on a lot, extract asteroid from the lot ID
      if (!asteroidLoc && shipLocation.label === Entity.IDS.LOT) {
        const { Lot } = require('@influenceth/sdk');
        const asteroidId = Lot.toPosition(shipLocation.id)?.asteroidId;
        if (asteroidId) asteroidLoc = { id: asteroidId, label: Entity.IDS.ASTEROID };
      }
      if (!asteroidLoc) throw new ValidationError('Cannot determine asteroid for launch');

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

      // Check there's enough propellant (mass is in grams)
      const currentMass = this.propellantInv.mass || 0;
      if (currentMass < this.propellantRequired) {
        throw new ValidationError('Insufficient propellant for powered launch');
      }
    }
  }

  async applyStateChanges() {
    // Move ship to the asteroid (undock from building/lot to orbit)
    const locations = this.ship.Location?.locations || [];
    let asteroid = locations.find((l) => l.label === Entity.IDS.ASTEROID);
    // If landed on a lot, extract asteroid from the lot ID
    if (!asteroid && this.dock?.label === Entity.IDS.LOT) {
      const { Lot } = require('@influenceth/sdk');
      const asteroidId = Lot.toPosition(this.dock.id)?.asteroidId;
      if (asteroidId) asteroid = { id: asteroidId, label: Entity.IDS.ASTEROID };
    }
    if (!asteroid) throw new ValidationError('Cannot determine asteroid for undocking');

    await this.writeComponent('Location', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      location: asteroid,
      locations: [asteroid]
    });

    // Decrement docked ships count if undocking from a building
    if (this.originalLocation && this.originalLocation.label === Entity.IDS.BUILDING) {
      const dockData = await ComponentService.findOne('Dock', {
        'entity.id': this.originalLocation.id, 'entity.label': this.originalLocation.label
      });
      if (dockData) {
        await this.writeComponent('Dock', {
          entity: { id: this.originalLocation.id, label: this.originalLocation.label },
          dockType: dockData.dockType,
          dockedShips: Math.max(0, dockData.dockedShips - 1)
        });
      }
    }

    // Set crew busy for undocking procedure (skip if powered — propellant launch is instant)
    if (!this.powered) {
      await this.setCrewBusy(this.crew, this.now + this.capDuration(60));
    }

    // Deduct propellant if powered launch
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
