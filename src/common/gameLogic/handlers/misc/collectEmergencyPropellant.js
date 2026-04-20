const { Entity, Ship, Product } = require('@influenceth/sdk');
const { EntityService, ComponentService } = require('@common/services');
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
      components: ['Crew', 'Location', 'Control', 'Ship'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // Crew can be on a regular ship or in an escape module (crew IS the ship)
    const crewLocation = this.crew.Location?.location;
    if (crewLocation && crewLocation.label === Entity.IDS.SHIP) {
      this.ship = { id: crewLocation.id, label: Entity.IDS.SHIP };
    } else if (this.crew.Ship && this.crew.Ship.emergencyAt > 0) {
      // Escape module: the crew entity is the ship
      this.ship = { id: this.crew.id, label: Entity.IDS.CREW };
    } else {
      throw new ValidationError('Crew is not on a ship or in an escape module');
    }
    this.amount = Number(this.vars.amount || 0);
  }

  async applyStateChanges() {
    // Determine ship config for propellant details
    const shipDoc = await ComponentService.findOneByEntity('Ship', this.ship);
    if (!shipDoc) throw new ValidationError('Ship component not found');
    const shipConfig = Ship.TYPES[shipDoc.shipType];
    if (!shipConfig || !shipConfig.propellantSlot || !shipConfig.propellantType) {
      throw new ValidationError('Ship has no propellant configuration');
    }

    // Read current inventory (may not exist yet for escape modules)
    const inventories = await ComponentService.findByEntity('Inventory', this.ship);
    let propInv = inventories.find((i) => i.slot === shipConfig.propellantSlot);

    const pt = Product.TYPES[shipConfig.propellantType];
    const unitMass = pt?.massPerUnit || 1;
    const unitVolume = pt?.volumePerUnit || 1;

    if (propInv) {
      // Update existing inventory with collected propellant
      const existingAmount = (propInv.contents || [])
        .find((c) => c.product === shipConfig.propellantType)?.amount || 0;
      const newAmount = existingAmount + this.amount;
      const contents = [{ product: shipConfig.propellantType, amount: newAmount }];
      await this.writeComponent('Inventory', {
        entity: this.ship,
        slot: shipConfig.propellantSlot,
        inventoryType: propInv.inventoryType,
        status: propInv.status,
        mass: newAmount * unitMass,
        volume: newAmount * unitVolume,
        reservedMass: propInv.reservedMass || 0,
        reservedVolume: propInv.reservedVolume || 0,
        contents
      });
    } else {
      // Create propellant inventory for escape module
      const contents = [{ product: shipConfig.propellantType, amount: this.amount }];
      await this.writeComponent('Inventory', {
        entity: this.ship,
        slot: shipConfig.propellantSlot,
        inventoryType: shipConfig.propellantInventoryType || 11,
        status: 1, // AVAILABLE
        mass: this.amount * unitMass,
        volume: this.amount * unitVolume,
        reservedMass: 0,
        reservedVolume: 0,
        contents
      });
    }

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
