const { Asteroid, Deposit, Entity, Inventory, Lot, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

const CORE_DRILL_PRODUCT = 175;

class SampleDepositImproveHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SamplingDepositStarted'; }

  async validate() {
    const { deposit: depositRef, lot: lotRef, origin: originRef, origin_slot: originSlot, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!depositRef?.id) throw new ValidationError('vars.deposit with id is required');
    if (!lotRef?.id) throw new ValidationError('vars.lot with id is required');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (originSlot === undefined || originSlot === null) throw new ValidationError('vars.origin_slot is required');

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

    // 2. Deposit must exist and be SAMPLED (can only improve a sampled deposit)
    this.deposit = await EntityService.getEntity({
      id: depositRef.id,
      label: Entity.IDS.DEPOSIT,
      components: ['Deposit', 'Control'],
      format: true
    });
    if (!this.deposit) throw new ValidationError('Deposit not found');
    StateMachineValidator.assertStatus(this.deposit.Deposit, Deposit.STATUSES.SAMPLED, 'Deposit');

    // 3. Lot must exist
    this.lot = await EntityService.getEntity({
      id: lotRef.id,
      label: Entity.IDS.LOT,
      components: ['Location'],
      format: true
    });
    if (!this.lot) throw new ValidationError('Lot not found');

    // 3b. Asteroid must be resource-scanned
    const lotPosition = Lot.toPosition(lotRef.id);
    const asteroidCelestial = await ComponentService.findOne('Celestial', {
      'entity.id': lotPosition.asteroidId,
      'entity.label': Entity.IDS.ASTEROID
    });
    if (!asteroidCelestial || asteroidCelestial.scanStatus !== Asteroid.SCAN_STATUSES.RESOURCE_SCANNED) {
      throw new ValidationError('Asteroid must be resource-scanned before sampling');
    }

    // 4. Origin inventory must contain at least 1 Core Drill
    this.originSlotNum = Number(originSlot) || 1;
    const originEntity = { id: originRef.id, label: originRef.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    this.originInv = originInventories.find((inv) => inv.slot === this.originSlotNum);
    if (!this.originInv) throw new ValidationError('Origin inventory not found');
    if (this.originInv.status !== Inventory.STATUSES.AVAILABLE) {
      throw new ValidationError('Origin inventory is not available');
    }
    const coreDrill = (this.originInv.contents || []).find((c) => c.product === CORE_DRILL_PRODUCT);
    if (!coreDrill || coreDrill.amount < 1) {
      throw new ValidationError('Origin inventory does not contain a Core Drill');
    }
  }

  async applyStateChanges() {
    const sampleTime = Deposit.getSampleTime(1);
    this.finishTime = this.now + await this.gameSecondsToReal(sampleTime);

    // Set deposit back to SAMPLING for the improvement round
    await this.writeComponent('Deposit', {
      entity: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      resource: this.deposit.Deposit.resource,
      status: Deposit.STATUSES.SAMPLING,
      initialYield: this.deposit.Deposit.initialYield,
      remainingYield: this.deposit.Deposit.remainingYield,
      yieldEff: this.deposit.Deposit.yieldEff,
      finishTime: this.finishTime
    });

    // Deduct 1 Core Drill from origin inventory
    const updatedContents = (this.originInv.contents || []).map((c) => {
      if (c.product === CORE_DRILL_PRODUCT) return { product: c.product, amount: c.amount - 1 };
      return c;
    }).filter((c) => c.amount > 0);

    let newMass = 0;
    let newVolume = 0;
    for (const c of updatedContents) {
      const pt = Product.TYPES[c.product];
      if (pt) { newMass += c.amount * pt.massPerUnit; newVolume += c.amount * pt.volumePerUnit; }
    }

    const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label };
    await this.writeComponent('Inventory', {
      entity: originEntity,
      inventoryType: this.originInv.inventoryType,
      slot: this.originInv.slot,
      status: this.originInv.status,
      mass: newMass,
      volume: newVolume,
      reservedMass: this.originInv.reservedMass || 0,
      reservedVolume: this.originInv.reservedVolume || 0,
      contents: updatedContents
    });

    await this.setCrewBusy(this.crew, this.finishTime);

    return { depositId: this.deposit.id, finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      deposit: { id: this.deposit.id, label: Entity.IDS.DEPOSIT },
      lot: this.vars.lot,
      resource: this.deposit.Deposit.resource,
      improving: true,
      origin: this.vars.origin,
      originSlot: Number(this.vars.origin_slot),
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SamplingDepositStarted/v1');
  }
}

module.exports = SampleDepositImproveHandler;
