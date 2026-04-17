const { Entity, Extractor, Inventory, Product } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ExtractResourceFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ResourceExtractionFinished'; }

  async validate() {
    const { extractor: extractorRef, extractor_slot: extractorSlot, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!extractorRef?.id) throw new ValidationError('vars.extractor with id is required');

    this.extractorSlot = Number(extractorSlot) || 1;

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Extractor must exist and be RUNNING
    this.extractor = await EntityService.getEntity({
      id: extractorRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.extractor) throw new ValidationError('Extractor building not found');

    // 3. Find the extractor component for this slot
    this.extractorComponent = await ComponentService.findOne('Extractor', {
      'entity.id': extractorRef.id,
      'entity.label': Entity.IDS.BUILDING,
      slot: this.extractorSlot
    });
    if (!this.extractorComponent) throw new ValidationError('Extractor slot not found');
    if (this.extractorComponent.status !== Extractor.STATUSES.RUNNING) {
      throw new ValidationError('Extractor is not running');
    }

    // 4. Extraction must be finished
    const now = Math.floor(Date.now() / 1000);
    if (this.extractorComponent.finishTime > now) {
      throw new ValidationError('Extraction not finished yet');
    }
  }

  async applyStateChanges() {
    const { outputProduct, destination, destinationSlot } = this.extractorComponent;
    const extractedYield = this.extractorComponent.yield;

    // Set extractor back to IDLE
    await this.writeComponent('Extractor', {
      entity: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      slot: this.extractorSlot,
      status: Extractor.STATUSES.IDLE,
      outputProduct,
      yield: 0,
      destination,
      destinationSlot,
      finishTime: 0
    });

    // Add extracted product to destination inventory
    if (extractedYield > 0 && outputProduct && destination) {
      const destEntity = { id: destination.id, label: destination.label };
      const destInvs = await ComponentService.findByEntity('Inventory', destEntity);
      const destInv = destInvs.find((inv) => inv.slot === (destinationSlot || 1));

      if (destInv) {
        // yield is in grams; product amounts are stored in grams
        const updatedContents = [...(destInv.contents || [])];
        const existing = updatedContents.find((c) => c.product === outputProduct);
        if (existing) {
          existing.amount += extractedYield;
        } else {
          updatedContents.push({ product: outputProduct, amount: extractedYield });
        }

        let newMass = 0;
        let newVolume = 0;
        for (const c of updatedContents) {
          const pt = Product.TYPES[c.product];
          if (pt) {
            newMass += c.amount * pt.massPerUnit;
            newVolume += c.amount * pt.volumePerUnit;
          }
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
    }

    return { extractorId: this.extractor.id };
  }

  getReturnValues() {
    return {
      extractor: { id: this.extractor.id, label: Entity.IDS.BUILDING },
      extractorSlot: this.extractorSlot,
      resource: this.extractorComponent.outputProduct,
      yield: this.extractorComponent.yield,
      destination: this.extractorComponent.destination,
      destinationSlot: this.extractorComponent.destinationSlot,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ResourceExtractionFinished');
  }
}

module.exports = ExtractResourceFinishHandler;
