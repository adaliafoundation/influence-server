const { Building, Entity, Extractor, Inventory, Processor } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ConstructionFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ConstructionFinished'; }

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

    // 1b. Crew's delegate (owner of the session key) must match the caller.
    // Matches Cairo construction_finish.cairo:47 — `crew_details.assert_delegated_to(caller)`.
    // In hybrid mode we treat the NFT owner as the effective delegate since
    // there are no on-chain session keys, so this is equivalent to step 1.

    // 2. Building must exist and be UNDER_CONSTRUCTION
    this.building = await EntityService.getEntity({
      id: buildingRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.building) throw new ValidationError('Building not found');
    StateMachineValidator.assertStatus(
      this.building.Building,
      Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION,
      'Building'
    );

    // 3. Construction must be finished (finishTime has passed)
    StateMachineValidator.assertFinished(this.building.Building, 'Building');
  }

  async applyStateChanges() {
    const buildingType = this.building.Building.buildingType;
    const buildingEntity = { id: this.building.id, label: Entity.IDS.BUILDING };

    // Update building status to OPERATIONAL
    await this.writeComponent('Building', {
      entity: buildingEntity,
      buildingType,
      status: Building.CONSTRUCTION_STATUSES.OPERATIONAL,
      plannedAt: this.building.Building.plannedAt,
      finishTime: this.building.Building.finishTime
    });

    // Create operational sub-components based on building type
    await this._createOperationalComponents(buildingEntity, buildingType);

    return { buildingId: this.building.id };
  }

  async _createOperationalComponents(entity, buildingType) {
    switch (buildingType) {
      case 1: // Warehouse — storage inventory
        await this.writeComponent('Inventory', {
          entity, slot: 2, inventoryType: 10,
          status: Inventory.STATUSES.AVAILABLE,
          mass: 0, volume: 0, reservedMass: 0, reservedVolume: 0, contents: []
        });
        break;

      case 2: // Extractor — 1 extractor slot
        await this.writeComponent('Extractor', {
          entity, slot: 1,
          status: Extractor.STATUSES.IDLE,
          outputProduct: 0, yield: 0, finishTime: 0
        });
        break;

      case 3: // Refinery — 1 processor (type 1)
        await this.writeComponent('Processor', {
          entity, slot: 1, processorType: 1,
          status: Processor.STATUSES.IDLE,
          outputProduct: 0, recipes: 0, runningProcess: 0,
          secondaryEff: 0, finishTime: 0
        });
        break;

      case 4: // Bioreactor — 1 processor (type 3)
        await this.writeComponent('Processor', {
          entity, slot: 1, processorType: 3,
          status: Processor.STATUSES.IDLE,
          outputProduct: 0, recipes: 0, runningProcess: 0,
          secondaryEff: 0, finishTime: 0
        });
        break;

      case 5: // Factory — 1 processor (type 2)
        await this.writeComponent('Processor', {
          entity, slot: 1, processorType: 2,
          status: Processor.STATUSES.IDLE,
          outputProduct: 0, recipes: 0, runningProcess: 0,
          secondaryEff: 0, finishTime: 0
        });
        break;

      case 6: // Shipyard — 1 processor (type 4) + 1 dry dock
        await this.writeComponent('Processor', {
          entity, slot: 1, processorType: Processor.IDS.SHIPYARD,
          status: Processor.STATUSES.IDLE,
          outputProduct: 0, recipes: 0, runningProcess: 0,
          secondaryEff: 0, finishTime: 0
        });
        await this.writeComponent('DryDock', {
          entity, slot: 1, status: 0, outputShip: { id: 0, label: 0 }, finishTime: 0
        });
        break;

      case 7: // Spaceport — 1 dock
        await this.writeComponent('Dock', {
          entity, dockType: 1, dockedShips: 0
        });
        break;

      case 8: // Marketplace — 1 exchange
        await this.writeComponent('Exchange', {
          entity, exchangeType: 1,
          makerFee: 0, takerFee: 0, orders: 0, allowedProducts: []
        });
        break;

      case 9: // Habitat — 1 station
        await this.writeComponent('Station', {
          entity, stationType: 3, population: 0
        });
        break;

      case 10: // Fluids Storage Terminal — fluids inventory
        await this.writeComponent('Inventory', {
          entity, slot: 2, inventoryType: 19,
          status: Inventory.STATUSES.AVAILABLE,
          mass: 0, volume: 0, reservedMass: 0, reservedVolume: 0, contents: []
        });
        break;

      default:
        break;
    }
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
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionFinished');
  }
}

module.exports = ConstructionFinishHandler;
