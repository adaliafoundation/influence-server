const { Building, Deposit, Entity, Extractor, Permission, Ship } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');
const { crewToLotTravelTime, getAsteroidLot, hopperTravelTime } = require('../../helpers/travel');

// The SDK's Permission.IDS map is missing USE_DEPOSIT; mirror the Cairo
// constant (permissions.cairo:14) until the SDK catches up.
const PERMISSION_USE_DEPOSIT = Permission.IDS.USE_DEPOSIT || 14;

class ExtractResourceStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ResourceExtractionStarted'; }

  async validate() {
    const {
      extractor: extractorRef,
      extractor_slot: extractorSlot,
      yield: targetYield,
      deposit: depositRef,
      destination: destRef,
      destination_slot: destSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!extractorRef?.id) throw new ValidationError('vars.extractor with id is required');
    if (!depositRef?.id) throw new ValidationError('vars.deposit with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');
    if (!targetYield || targetYield <= 0) throw new ValidationError('vars.yield must be positive');

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

    // 2. Extractor building must exist and be OPERATIONAL
    this.extractor = await EntityService.getEntity({
      id: extractorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.extractor) throw new ValidationError('Extractor building not found');
    if (this.extractor.Building.status !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) {
      throw new ValidationError('Extractor building is not operational');
    }

    // 2b. Extractor slot must be IDLE
    const extractorEntity = { id: extractorRef.id, label: Entity.IDS.BUILDING };
    const extractors = await ComponentService.findByEntity('Extractor', extractorEntity);
    const slot = extractors.find((e) => e.slot === (Number(extractorSlot) || 1));
    if (!slot || slot.status !== 0) {
      throw new ValidationError('Extractor slot is not idle');
    }

    // 3. Must have EXTRACT_RESOURCES permission on the extractor
    await AccessValidator.assertPermission(this.crew, this.extractor, Permission.IDS.EXTRACT_RESOURCES);

    // 4. Deposit must exist and be SAMPLED or USED
    this.deposit = await EntityService.getEntity({
      id: depositRef.id,
      label: Entity.IDS.DEPOSIT,
      components: ['Deposit'],
      format: true
    });
    if (!this.deposit) throw new ValidationError('Deposit not found');
    if (this.deposit.Deposit.status !== Deposit.STATUSES.SAMPLED
      && this.deposit.Deposit.status !== Deposit.STATUSES.USED) {
      throw new ValidationError('Deposit must be sampled before extraction');
    }
    if (this.deposit.Deposit.remainingYield < targetYield) {
      throw new ValidationError('Target yield exceeds remaining deposit yield');
    }

    // 4b. Caller crew must have USE_DEPOSIT permission on the deposit
    // (matches influence-starknet/src/systems/production/extract_resource_start.cairo:61)
    await AccessValidator.assertPermission(this.crew, this.deposit, PERMISSION_USE_DEPOSIT);

    // 5. Destination must exist and be ready to receive.
    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location', 'Building', 'Ship'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    if (Number(destRef.label) === Entity.IDS.BUILDING) {
      if (this.destination.Building?.status !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) {
        throw new ValidationError('Destination building is not operational');
      }
    } else if (Number(destRef.label) === Entity.IDS.SHIP) {
      // Ship must be parked, and if docked inside a building that building
      // must be operational — matches extract_resource_start.cairo:91-99.
      const shipStatus = this.destination.Ship?.status;
      if (shipStatus !== Ship.STATUSES.AVAILABLE) {
        throw new ValidationError('Destination ship is not available');
      }
      const shipLoc = this.destination.Location?.location;
      if (shipLoc?.label === Entity.IDS.BUILDING) {
        const dockBuilding = await ComponentService.findOneByEntity('Building', shipLoc);
        if (dockBuilding?.status !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) {
          throw new ValidationError('Destination ship is docked at a non-operational building');
        }
      }
    }

    // 6. All of crew / extractor / deposit / destination must be on the
    //    same asteroid and on-surface (Cairo extract_resource_start.cairo:78-86).
    const [crewLoc, extLoc, depLoc, destLocResolved] = await Promise.all([
      getAsteroidLot(this.crew),
      getAsteroidLot(this.extractor),
      getAsteroidLot(this.deposit),
      getAsteroidLot(this.destination)
    ]);
    if (!crewLoc || !extLoc || !depLoc || !destLocResolved) {
      throw new ValidationError('Missing location data for one of the entities');
    }
    const asteroidId = extLoc.asteroidId;
    if (depLoc.asteroidId !== asteroidId
        || destLocResolved.asteroidId !== asteroidId
        || crewLoc.asteroidId !== asteroidId) {
      throw new ValidationError('All entities must be on the same asteroid');
    }
    if (extLoc.lotIndex !== depLoc.lotIndex) {
      throw new ValidationError('Extractor and deposit must be on the same lot');
    }
    if (!destLocResolved.lotIndex || !crewLoc.lotIndex) {
      throw new ValidationError('Crew and destination must be on the surface');
    }
    this._crewLoc = crewLoc;
    this._extLoc = extLoc;
    this._destLoc = destLocResolved;
    this._asteroidId = asteroidId;

    // 7. Caller must have ADD_PRODUCTS permission on the destination.
    // We defer the time-bounded version to applyStateChanges once we know
    // finishTime — matches extract_resource_start.cairo:159 (checked post-
    // finish-time).
    await AccessValidator.assertPermission(this.crew, this.destination, Permission.IDS.ADD_PRODUCTS);

    this.extractorSlot = Number(extractorSlot) || 1;
    this.destSlot = Number(destSlot) || 1;
    this.targetYield = Number(targetYield);
  }

  async applyStateChanges() {
    const extractionGameSeconds = Extractor.getExtractionTime(
      this.targetYield, this.deposit.Deposit.remainingYield, 1
    );
    const extractionRealSeconds = await this.gameSecondsToReal(extractionGameSeconds);

    // Hopper travel: crew→deposit and deposit→destination, in game-seconds.
    const crewToDeposit = hopperTravelTime(
      this._asteroidId, this._crewLoc.lotIndex, this._extLoc.lotIndex
    );
    const depositToDest = hopperTravelTime(
      this._asteroidId, this._extLoc.lotIndex, this._destLoc.lotIndex
    );
    const crewToDepositReal = await this.gameSecondsToReal(crewToDeposit);
    const depositToDestReal = await this.gameSecondsToReal(depositToDest);

    // Cairo extract_resource_start.cairo:148 — finishTime is when the
    // extracted product is delivered: crew→deposit + extract + deposit→dest.
    this.finishTime = this.now + crewToDepositReal + extractionRealSeconds + depositToDestReal;

    // 7b. Time-bounded permissions (assert_can_until) — the agreements
    // granting extract and add-products access must cover the finish time.
    await AccessValidator.assertPermissionUntil(
      this.crew, this.extractor, Permission.IDS.EXTRACT_RESOURCES, this.finishTime
    );
    await AccessValidator.assertPermissionUntil(
      this.crew, this.destination, Permission.IDS.ADD_PRODUCTS, this.finishTime
    );

    // Reserve space on the destination inventory so concurrent actions
    // can't oversubscribe it during the extraction window.
    const destEntity = { id: this.destination.id, label: this.destination.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    const destInv = destInventories.find((i) => i.slot === this.destSlot);
    if (!destInv) throw new ValidationError('Destination inventory slot not found');
    await this.reserveInventory(destEntity, destInv, [
      { product: this.deposit.Deposit.resource, amount: this.targetYield }
    ]);

    // Update extractor component to RUNNING
    await this.writeComponent('Extractor', {
      entity: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      slot: this.extractorSlot,
      status: Extractor.STATUSES.RUNNING,
      outputProduct: this.deposit.Deposit.resource,
      yield: this.targetYield,
      destination: destEntity,
      destinationSlot: this.destSlot,
      finishTime: this.finishTime
    });

    // Update deposit remaining yield
    await this.writeComponent('Deposit', {
      entity: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      status: Deposit.STATUSES.USED,
      initialYield: this.deposit.Deposit.initialYield,
      remainingYield: this.deposit.Deposit.remainingYield - this.targetYield,
      yieldEff: this.deposit.Deposit.yieldEff,
      finishTime: this.finishTime
    });

    // Cairo extract_resource_start.cairo:162-163 — crew goes there,
    // works 1/8 of extract time, comes back. The full extraction runs
    // autonomously; the crew just sets it up and leaves.
    const crewWorkReal = Math.ceil(extractionRealSeconds / 8);
    const crewBusyUntil = this.now + crewToDepositReal + crewWorkReal + crewToDepositReal;
    await this.setCrewBusy(this.crew, crewBusyUntil);

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      deposit: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      yield: this.targetYield,
      extractor: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      extractorSlot: this.extractorSlot,
      destination: { id: this.destination.id, label: this.destination.label },
      destinationSlot: this.destSlot,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ResourceExtractionStarted');
  }
}

module.exports = ExtractResourceStartHandler;
