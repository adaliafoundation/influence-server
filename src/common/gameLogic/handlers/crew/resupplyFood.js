const { Entity, Product } = require('@influenceth/sdk');
const { EntityService, ComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

const FOOD_PRODUCT_ID = 129; // Product.IDS.FOOD

class CrewResupplyFoodHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'FoodSupplied'; }

  async validate() {
    const { origin: originRef, origin_slot: originSlot, food, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (originSlot === undefined || originSlot === null) throw new ValidationError('vars.origin_slot is required');
    if (!food || food <= 0) throw new ValidationError('vars.food must be a positive number');

    this.now = Math.floor(Date.now() / 1000);

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Origin must exist
    this.origin = await EntityService.getEntity({
      id: originRef.id,
      label: originRef.label,
      components: ['Location', 'Control'],
      format: true
    });
    if (!this.origin) throw new ValidationError('Origin not found');
  }

  async applyStateChanges() {
    const food = Number(this.vars.food);
    const originSlot = Number(this.vars.origin_slot);
    const originRef = this.vars.origin;

    // Deduct food from origin inventory
    const inventory = await ComponentService.findOne('Inventory', {
      'entity.id': originRef.id,
      'entity.label': originRef.label,
      slot: originSlot
    });

    if (inventory) {
      const contents = (inventory.contents || []).map((item) => {
        if (item.product === FOOD_PRODUCT_ID) {
          return { ...item, amount: Math.max(0, item.amount - food) };
        }
        return item;
      }).filter((item) => item.amount > 0);

      const foodInfo = Product.TYPES[FOOD_PRODUCT_ID] || { massPerUnit: 1000, volumePerUnit: 1250 };
      const massReduction = food * foodInfo.massPerUnit;
      const volumeReduction = food * foodInfo.volumePerUnit;

      await this.writeComponent('Inventory', {
        entity: { id: originRef.id, label: originRef.label },
        inventoryType: inventory.inventoryType,
        slot: originSlot,
        status: inventory.status,
        mass: Math.max(0, (inventory.mass || 0) - massReduction),
        volume: Math.max(0, (inventory.volume || 0) - volumeReduction),
        reservedMass: inventory.reservedMass || 0,
        reservedVolume: inventory.reservedVolume || 0,
        contents
      });
    }

    // Update crew's lastFed timestamp and set crew busy
    const finishTime = this.now + this.capDuration(60);
    await this.writeComponent('Crew', {
      entity: { id: this.crew.id, label: Entity.IDS.CREW },
      roster: this.crew.Crew.roster,
      lastFed: this.now,
      readyAt: finishTime,
      delegatedTo: this.crew.Crew.delegatedTo
    });
    this.finishTime = finishTime;

    return { crewId: this.crew.id, food };
  }

  getReturnValues() {
    return {
      food: Number(this.vars.food),
      lastFed: this.now,
      origin: this.vars.origin,
      originSlot: Number(this.vars.origin_slot),
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/FoodSupplied/v1');
  }
}

module.exports = CrewResupplyFoodHandler;
