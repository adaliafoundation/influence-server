const { Building, Entity, Inventory, Lot, Permission } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');
const IdGenerator = require('../../helpers/idGenerator');

class ConstructionPlanHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ConstructionPlanned'; }

  async validate() {
    const { building_type: buildingType, caller_crew: callerCrewRef, lot: lotRef } = this.vars || {};
    if (!buildingType) throw new ValidationError('vars.building_type is required');
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!lotRef?.id) throw new ValidationError('vars.lot with id is required');

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

    // 2. Crew must be ready (not busy)
    CrewValidator.assertReady(this.crew);

    // 3. Lot must exist on an asteroid
    this.lot = await EntityService.getEntity({
      id: lotRef.id,
      label: Entity.IDS.LOT,
      components: ['Location'],
      format: true
    });
    if (!this.lot) throw new ValidationError('Lot not found');

    // 4. Lot must not already have a building
    const existing = await EntityService.getEntities({
      label: Entity.IDS.BUILDING,
      match: {
        'Location.location.id': lotRef.id,
        'Location.location.label': Entity.IDS.LOT
      }
    });
    if (existing.length > 0) throw new ValidationError('Lot already has a building');

    // 5. Must have USE_LOT permission on the lot
    await AccessValidator.assertPermission(this.crew, this.lot, Permission.IDS.USE_LOT);

    // 6. Valid building type
    if (!Building.TYPES[buildingType]) throw new ValidationError('Invalid building type');
  }

  async applyStateChanges() {
    const buildingType = this.vars.building_type;
    const callerCrewRef = this.vars.caller_crew;
    const lotRef = this.vars.lot;

    // Generate a new building ID
    this.newBuildingId = await IdGenerator.next(Entity.IDS.BUILDING);

    // Resolve full location chain for the lot
    const lotEntity = EntityLib.toEntity(lotRef);
    const fullLocation = await LocationComponentService.getFullLocation(lotEntity);

    // Create the new Building entity and all its initial components
    await this.createEntityWithComponents(
      { id: this.newBuildingId, label: Entity.IDS.BUILDING },
      [
        {
          component: 'Building',
          data: {
            buildingType: Number(buildingType),
            status: Building.CONSTRUCTION_STATUSES.PLANNED,
            plannedAt: this.now,
            finishTime: 0
          }
        },
        {
          component: 'Control',
          data: {
            controller: EntityLib.toEntity(callerCrewRef).toObject()
          }
        },
        {
          component: 'Location',
          data: {
            location: lotEntity.toObject(),
            locations: fullLocation
          }
        },
        {
          component: 'Name',
          data: { name: '' }
        },
        {
          component: 'Inventory',
          data: {
            inventoryType: Building.TYPES[Number(buildingType)].siteType,
            slot: Building.TYPES[Number(buildingType)].siteSlot,
            status: Inventory.STATUSES.AVAILABLE,
            mass: 0,
            volume: 0,
            reservedMass: 0,
            reservedVolume: 0,
            contents: []
          }
        }
      ]
    );

    return { buildingId: this.newBuildingId };
  }

  // returnValues must match what the chain's ConstructionPlanned event produces.
  // The existing Dispatcher/systems/ConstructionPlanned handler reads these fields
  // from this.eventDoc.returnValues in its processEvent() method.
  getReturnValues() {
    const buildingType = this.vars.building_type;
    const callerCrewRef = this.vars.caller_crew;
    const lotRef = this.vars.lot;
    const { asteroidId } = Lot.toPosition(lotRef.id);
    return {
      building: { id: this.newBuildingId, label: Entity.IDS.BUILDING },
      buildingType: Number(buildingType),
      asteroid: { id: asteroidId, label: Entity.IDS.ASTEROID },
      lot: lotRef,
      callerCrew: callerCrewRef,
      caller: this.address,
      gracePeriodEnd: this.now + 86400
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionPlanned');
  }
}

module.exports = ConstructionPlanHandler;
