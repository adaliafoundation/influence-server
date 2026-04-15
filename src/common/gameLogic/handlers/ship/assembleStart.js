const { Entity, Permission, Ship, Process } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const IdGenerator = require('../../helpers/idGenerator');
const { ValidationError } = require('../../errors');

class AssembleShipStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipAssemblyStarted'; }

  async validate() {
    const {
      dry_dock: dryDockRef,
      dry_dock_slot: dryDockSlot,
      ship_type: shipType,
      origin: originRef,
      origin_slot: originSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!dryDockRef?.id) throw new ValidationError('vars.dry_dock with id is required');
    if (!shipType) throw new ValidationError('vars.ship_type is required');

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
    CrewValidator.assertReady(this.crew);

    // 2. Dry dock building must exist
    this.dryDock = await EntityService.getEntity({
      id: dryDockRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.dryDock) throw new ValidationError('Dry dock not found');

    // 3. Must have ASSEMBLE_SHIP permission
    await AccessValidator.assertPermission(this.crew, this.dryDock, Permission.IDS.ASSEMBLE_SHIP);

    // 4. Ship type must be valid and constructable
    this.shipType = Number(shipType);
    const constructionType = Ship.getConstructionType(this.shipType);
    if (!constructionType) throw new ValidationError('Invalid or non-constructable ship type');

    this.dryDockSlot = Number(dryDockSlot) || 1;
    this.originSlot = Number(originSlot) || 1;
    this.originRef = originRef;
  }

  async applyStateChanges() {
    // Calculate assembly time from the ship's process type
    const shipTypeConfig = Ship.TYPES[this.shipType];
    const processConfig = Process.TYPES[shipTypeConfig.processType];
    const assemblyTime = (processConfig?.setupTime || 0) + (processConfig?.recipeTime || 0);
    this.finishTime = this.now + await this.gameSecondsToReal(assemblyTime);

    // Generate a new ship ID
    this.shipId = await IdGenerator.next(Entity.IDS.SHIP);

    // Resolve dry dock location for the ship
    const dryDockEntity = EntityLib.toEntity({ id: this.dryDock.id, label: Entity.IDS.BUILDING });
    const fullLocation = await LocationComponentService.getFullLocation(dryDockEntity);

    // Create ship entity with components
    await this.createEntityWithComponents(
      { id: this.shipId, label: Entity.IDS.SHIP },
      [
        {
          component: 'Ship',
          data: {
            shipType: this.shipType,
            status: Ship.STATUSES.UNDER_CONSTRUCTION,
            variant: Ship.getVariant(this.shipId),
            readyAt: 0,
            emergencyAt: 0,
            transitDeparture: 0,
            transitArrival: 0
          }
        },
        {
          component: 'Control',
          data: {
            controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
          }
        },
        {
          component: 'Location',
          data: {
            location: dryDockEntity.toObject(),
            locations: fullLocation
          }
        }
      ]
    );

    return { shipId: this.shipId, finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      ship: { id: this.shipId, label: Entity.IDS.SHIP },
      shipType: this.shipType,
      dryDock: { id: this.dryDock.id, label: Entity.IDS.BUILDING },
      dryDockSlot: this.dryDockSlot,
      origin: this.originRef || { id: this.dryDock.id, label: Entity.IDS.BUILDING },
      originSlot: this.originSlot,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipAssemblyStarted/v1');
  }
}

module.exports = AssembleShipStartHandler;
