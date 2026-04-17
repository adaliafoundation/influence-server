const { Building, Entity, Inventory, Permission, Process, Processor, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class ProcessProductsStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'MaterialProcessingStarted'; }

  async validate() {
    const {
      processor: processorRef,
      processor_slot: processorSlot,
      process: processId,
      recipes,
      origin: originRef,
      origin_slot: originSlot,
      destination: destRef,
      destination_slot: destSlot,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!processorRef?.id) throw new ValidationError('vars.processor with id is required');
    if (!processId) throw new ValidationError('vars.process is required');
    if (!recipes || recipes <= 0) throw new ValidationError('vars.recipes must be positive');
    if (!originRef?.id || !originRef?.label) throw new ValidationError('vars.origin with id and label is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');

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

    // 2. Processor building must exist and be OPERATIONAL
    this.processor = await EntityService.getEntity({
      id: processorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.processor) throw new ValidationError('Processor building not found');
    if (this.processor.Building.status !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) {
      throw new ValidationError('Processor building is not operational');
    }

    // 3. Must have RUN_PROCESS permission
    await AccessValidator.assertPermission(this.crew, this.processor, Permission.IDS.RUN_PROCESS);

    // 4. Process type must be valid
    if (!Process.TYPES[processId]) throw new ValidationError('Invalid process type');

    // 5. Origin and destination must exist
    this.origin = await EntityService.getEntity({
      id: originRef.id,
      label: originRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.origin) throw new ValidationError('Origin not found');

    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    this.processId = Number(processId);
    this.recipes = Number(recipes);
    this.processorSlot = Number(processorSlot) || 1;
    this.originSlot = Number(originSlot) || 1;
    this.destSlot = Number(destSlot) || 1;

    // 6. Load existing processor component — must be IDLE
    const processorEntity = { id: processorRef.id, label: Entity.IDS.BUILDING };
    const processors = await ComponentService.findByEntity('Processor', processorEntity);
    this.processorComponent = processors.find((p) => p.slot === this.processorSlot);
    if (!this.processorComponent || this.processorComponent.status !== 0) {
      throw new ValidationError('Processor slot is not idle');
    }

    // 6b. Process type must match processor type
    const processConfig = Process.TYPES[this.processId];
    if (processConfig.processorType !== this.processorComponent.processorType) {
      throw new ValidationError('Process type does not match processor type');
    }

    // 7. Compute required inputs
    this.inputProducts = Object.entries(processConfig.inputs).map(
      ([pid, amt]) => ({ product: Number(pid), amount: amt * this.recipes })
    );

    // 8. Origin inventory must exist, be available, and have enough of each input
    const originEntity = { id: originRef.id, label: originRef.label };
    const originInventories = await ComponentService.findByEntity('Inventory', originEntity);
    this.originInv = originInventories.find((inv) => inv.slot === this.originSlot);
    if (!this.originInv) throw new ValidationError('Origin inventory not found');
    if (this.originInv.status !== Inventory.STATUSES.AVAILABLE) {
      throw new ValidationError('Origin inventory is not available');
    }
    for (const p of this.inputProducts) {
      const available = (this.originInv.contents || []).find((c) => c.product === p.product);
      if (!available || available.amount < p.amount) {
        const name = Product.TYPES[p.product]?.name || p.product;
        throw new ValidationError(`Insufficient ${name} in origin (have ${available?.amount || 0}, need ${p.amount})`);
      }
    }

    // 9. Destination inventory must exist, be available, and have enough capacity for outputs
    const destEntity = { id: destRef.id, label: destRef.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    this.destInv = destInventories.find((inv) => inv.slot === this.destSlot);
    if (!this.destInv) throw new ValidationError('Destination inventory not found');
    if (this.destInv.status !== Inventory.STATUSES.AVAILABLE) {
      throw new ValidationError('Destination inventory is not available');
    }

    // getOutputs(processId, recipes, primaryOutputId) — 3rd arg is the product the
    // user designated as primary (better yield); 0 = default / no selection
    this.primaryOutputId = Number(this.vars.target_output) || 0;
    this.outputProducts = (Process.getOutputs(this.processId, this.recipes, this.primaryOutputId) || [])
      .map((o) => ({ product: o.id, amount: o.amount }));
    const capacity = Inventory.getFilledCapacity(this.destInv.inventoryType);
    let usedMass = 0;
    let usedVolume = 0;
    for (const c of (this.destInv.contents || [])) {
      const pt = Product.TYPES[c.product];
      if (pt) { usedMass += c.amount * pt.massPerUnit; usedVolume += c.amount * pt.volumePerUnit; }
    }
    let addedMass = 0;
    let addedVolume = 0;
    for (const o of this.outputProducts) {
      const pt = Product.TYPES[o.product];
      if (pt) { addedMass += o.amount * pt.massPerUnit; addedVolume += o.amount * pt.volumePerUnit; }
    }
    if (usedMass + addedMass > capacity.filledMass) {
      throw new ValidationError('Destination inventory does not have enough free mass');
    }
    if (usedVolume + addedVolume > capacity.filledVolume) {
      throw new ValidationError('Destination inventory does not have enough free volume');
    }
  }

  async applyStateChanges() {
    const setupTime = Process.getSetupTime(this.processId, 1);
    const processingTime = Process.getProcessingTime(this.processId, this.recipes, 1);
    this.finishTime = this.now + await this.gameSecondsToReal(Math.ceil(setupTime + processingTime));

    // Update processor component to RUNNING
    await this.writeComponent('Processor', {
      entity: { id: this.processor.id, label: Entity.IDS.BUILDING },
      slot: this.processorSlot,
      processorType: this.processorComponent?.processorType || 0,
      status: Processor.STATUSES.RUNNING,
      runningProcess: this.processId,
      recipes: this.recipes,
      outputProduct: this.primaryOutputId,
      destination: { id: this.destination.id, label: this.destination.label },
      destinationSlot: this.destSlot,
      finishTime: this.finishTime
    });

    // Subtract input materials from origin inventory
    const originEntity = { id: this.vars.origin.id, label: this.vars.origin.label };
    const updatedContents = (this.originInv.contents || []).map((c) => {
      const consumed = this.inputProducts.find((p) => p.product === c.product);
      if (!consumed) return c;
      return { product: c.product, amount: c.amount - consumed.amount };
    }).filter((c) => c.amount > 0);

    let newMass = 0;
    let newVolume = 0;
    for (const c of updatedContents) {
      const pt = Product.TYPES[c.product];
      if (pt) { newMass += c.amount * pt.massPerUnit; newVolume += c.amount * pt.volumePerUnit; }
    }

    await this.writeComponent('Inventory', {
      entity: originEntity,
      inventoryType: this.originInv.inventoryType,
      slot: this.originInv.slot,
      status: this.originInv.status,
      mass: newMass,
      volume: newVolume,
      reservedMass: this.originInv.reservedMass,
      reservedVolume: this.originInv.reservedVolume,
      contents: updatedContents
    });

    await this.setCrewBusy(this.crew, this.finishTime);

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      processor: { id: this.processor.id, label: Entity.IDS.BUILDING },
      processorSlot: this.processorSlot,
      process: this.processId,
      inputs: [],
      origin: this.vars.origin,
      originSlot: this.originSlot,
      outputs: [],
      destination: this.vars.destination,
      destinationSlot: this.destSlot,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingStarted/v1');
  }
}

module.exports = ProcessProductsStartHandler;
