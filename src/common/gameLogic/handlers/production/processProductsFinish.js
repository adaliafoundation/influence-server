const { Entity, Process, Processor, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ProcessProductsFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'MaterialProcessingFinished'; }

  async validate() {
    const { processor: processorRef, processor_slot: processorSlot, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!processorRef?.id) throw new ValidationError('vars.processor with id is required');

    this.processorSlot = Number(processorSlot) || 1;

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Processor building must exist
    this.processor = await EntityService.getEntity({
      id: processorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.processor) throw new ValidationError('Processor building not found');

    // 3. Find the processor component for this slot
    this.processorComponent = await ComponentService.findOne('Processor', {
      'entity.id': processorRef.id,
      'entity.label': Entity.IDS.BUILDING,
      slot: this.processorSlot
    });
    if (!this.processorComponent) throw new ValidationError('Processor slot not found');
    if (this.processorComponent.status !== Processor.STATUSES.RUNNING) {
      throw new ValidationError('Processor is not running');
    }

    // 4. Processing must be finished
    const now = Math.floor(Date.now() / 1000);
    if (this.processorComponent.finishTime > now) {
      throw new ValidationError('Processing not finished yet');
    }
  }

  async applyStateChanges() {
    // Compute output products from the process
    const { runningProcess, recipes, outputProduct, destination, destinationSlot } = this.processorComponent;
    // getOutputs(processId, recipes, primaryOutputId) — 3rd arg is the user's primary output selection
    const outputProducts = (Process.getOutputs(runningProcess, recipes, outputProduct || 0) || [])
      .map((o) => ({ product: o.id, amount: o.amount }));

    // Add output products to destination inventory
    const destEntity = { id: destination.id, label: destination.label };
    const destInventories = await ComponentService.findByEntity('Inventory', destEntity);
    const destInv = destInventories.find((inv) => inv.slot === (destinationSlot || 1));
    if (destInv) {
      const updatedContents = [...(destInv.contents || [])];
      for (const item of outputProducts) {
        const existing = updatedContents.find((c) => c.product === item.product);
        if (existing) {
          existing.amount += item.amount;
        } else {
          updatedContents.push({ product: item.product, amount: item.amount });
        }
      }

      let newMass = 0;
      let newVolume = 0;
      for (const c of updatedContents) {
        const pt = Product.TYPES[c.product];
        if (pt) { newMass += c.amount * pt.massPerUnit; newVolume += c.amount * pt.volumePerUnit; }
      }

      await this.writeComponent('Inventory', {
        entity: destEntity,
        inventoryType: destInv.inventoryType,
        slot: destInv.slot,
        status: destInv.status,
        mass: newMass,
        volume: newVolume,
        reservedMass: 0,
        reservedVolume: 0,
        contents: updatedContents
      });
    }

    // Set processor back to IDLE
    await this.writeComponent('Processor', {
      entity: { id: this.processor.id, label: Entity.IDS.BUILDING },
      slot: this.processorSlot,
      processorType: this.processorComponent?.processorType || 0,
      status: Processor.STATUSES.IDLE,
      runningProcess: 0,
      recipes: 0,
      outputProduct: 0,
      destination,
      destinationSlot,
      finishTime: 0
    });

    return { processorId: this.processor.id };
  }

  getReturnValues() {
    return {
      processor: { id: this.processor.id, label: Entity.IDS.BUILDING },
      processorSlot: this.processorSlot,
      destination: this.processorComponent.destination,
      destinationSlot: this.processorComponent.destinationSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingFinished');
  }
}

module.exports = ProcessProductsFinishHandler;
