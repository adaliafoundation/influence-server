const { Building, Entity, Inventory, Process } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ConstructionStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ConstructionStarted'; }

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

    // 3. Building must exist and be in PLANNED status
    this.building = await EntityService.getEntity({
      id: buildingRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.building) throw new ValidationError('Building not found');
    StateMachineValidator.assertStatus(
      this.building.Building,
      Building.CONSTRUCTION_STATUSES.PLANNED,
      'Building'
    );

    // 4. Caller must control the building
    await AccessValidator.assertControlledBy(this.building, this.address);

    // 5. Site inventory must have enough construction materials
    const buildingType = this.building.Building.buildingType;
    const constructionType = Building.getConstructionType(buildingType);
    if (constructionType?.requirements) {
      const buildingEntity = { id: this.building.id, label: Entity.IDS.BUILDING };
      const inventories = await ComponentService.findByEntity('Inventory', buildingEntity);
      const siteInv = inventories.find((inv) => inv.slot === 1);
      const contentsMap = {};
      if (siteInv?.contents) {
        for (const item of siteInv.contents) {
          contentsMap[item.product] = (contentsMap[item.product] || 0) + item.amount;
        }
      }
      for (const [product, required] of Object.entries(constructionType.requirements)) {
        const available = contentsMap[product] || 0;
        if (available < required) {
          throw new ValidationError('Insufficient construction materials');
        }
      }
    }
  }

  async applyStateChanges() {
    const buildingType = this.building.Building.buildingType;
    const processType = Building.TYPES[buildingType]?.processType;
    const processConfig = Process.TYPES[processType];

    // setupTime is in game-seconds; convert to real-seconds via TIME_ACCELERATION
    const setupTime = processConfig?.setupTime || 86400;
    const constructionTime = await this.gameSecondsToReal(setupTime);
    this.finishTime = this.now + constructionTime;

    // Update building status to UNDER_CONSTRUCTION
    await this.writeComponent('Building', {
      entity: { id: this.building.id, label: Entity.IDS.BUILDING },
      buildingType,
      status: Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION,
      plannedAt: this.building.Building.plannedAt,
      finishTime: this.finishTime
    });

    // Lock site inventory so no more materials can be delivered
    const buildingEntity = { id: this.building.id, label: Entity.IDS.BUILDING };
    const inventories = await ComponentService.findByEntity('Inventory', buildingEntity);
    const siteInv = inventories.find((inv) =>
      Inventory.TYPES[inv.inventoryType]?.category === Inventory.CATEGORIES.SITE
    );
    if (siteInv) {
      await this.writeComponent('Inventory', {
        entity: buildingEntity,
        inventoryType: siteInv.inventoryType,
        slot: siteInv.slot,
        status: Inventory.STATUSES.UNAVAILABLE,
        mass: siteInv.mass,
        volume: siteInv.volume,
        reservedMass: siteInv.reservedMass,
        reservedVolume: siteInv.reservedVolume,
        contents: siteInv.contents
      });
    }

    // Mark crew as busy for a fraction of the build time (Cairo: 2*travelTime + buildTime/8)
    const crewBusyUntil = this.now + Math.ceil(constructionTime / 8);
    await this.setCrewBusy(this.crew, crewBusyUntil);

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      building: { id: this.building.id, label: Entity.IDS.BUILDING },
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionStarted');
  }
}

module.exports = ConstructionStartHandler;
