const { Building, Entity, Inventory } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ConstructionDeconstructHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ConstructionDeconstructed'; }

  async validate() {
    const { building: buildingRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!buildingRef?.id) throw new ValidationError('vars.building with id is required');
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');

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

    // 2. Crew must be ready
    CrewValidator.assertReady(this.crew);

    // 3. Building must exist and be OPERATIONAL
    this.building = await EntityService.getEntity({
      id: buildingRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.building) throw new ValidationError('Building not found');
    StateMachineValidator.assertStatus(
      this.building.Building,
      Building.CONSTRUCTION_STATUSES.OPERATIONAL,
      'Building'
    );

    // 4. Caller must control the building
    await AccessValidator.assertControlledBy(this.building, this.address);
  }

  async applyStateChanges() {
    const buildingEntity = { id: this.building.id, label: Entity.IDS.BUILDING };

    // Deconstruct reverts building to PLANNED status
    await this.writeComponent('Building', {
      entity: buildingEntity,
      buildingType: this.building.Building.buildingType,
      status: Building.CONSTRUCTION_STATUSES.PLANNED,
      plannedAt: this.now,
      finishTime: 0
    });

    // Flip inventory statuses: site inventory → AVAILABLE, operational → UNAVAILABLE
    const inventories = await ComponentService.findByEntity('Inventory', buildingEntity);
    for (const inv of inventories) {
      const isSite = Inventory.TYPES[inv.inventoryType]?.category === Inventory.CATEGORIES.SITE;
      const newStatus = isSite ? Inventory.STATUSES.AVAILABLE : Inventory.STATUSES.UNAVAILABLE;
      if (inv.status !== newStatus) {
        // eslint-disable-next-line no-await-in-loop
        await this.writeComponent('Inventory', {
          entity: buildingEntity,
          inventoryType: inv.inventoryType,
          slot: inv.slot,
          status: newStatus,
          mass: inv.mass,
          volume: inv.volume,
          reservedMass: inv.reservedMass,
          reservedVolume: inv.reservedVolume,
          contents: inv.contents
        });
      }
    }

    return { buildingId: this.building.id };
  }

  getReturnValues() {
    return {
      building: { id: this.building.id, label: Entity.IDS.BUILDING },
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionDeconstructed');
  }
}

module.exports = ConstructionDeconstructHandler;
