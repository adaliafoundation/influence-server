const { Asteroid, Entity, Product } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ScanResourcesFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ResourceScanFinished'; }

  async validate() {
    const { asteroid: asteroidRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Asteroid must be RESOURCE_SCANNING and scan must be finished
    this.asteroid = await EntityService.getEntity({
      id: asteroidRef.id,
      label: Entity.IDS.ASTEROID,
      components: ['Celestial'],
      format: true
    });
    if (!this.asteroid) throw new ValidationError('Asteroid not found');
    if (this.asteroid.Celestial?.scanStatus !== Asteroid.SCAN_STATUSES.RESOURCE_SCANNING) {
      throw new ValidationError('Asteroid is not currently resource scanning');
    }
    StateMachineValidator.assertFinished(this.asteroid.Celestial, 'Resource scan');
  }

  async applyStateChanges() {
    // Generate deterministic abundances based on asteroid ID
    this.abundances = this._generateAbundances();
    const packedAbundances = this._packAbundances(this.abundances);

    await this.writeComponent('Celestial', {
      entity: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      celestialType: this.asteroid.Celestial.celestialType,
      mass: this.asteroid.Celestial.mass,
      radius: this.asteroid.Celestial.radius,
      purchaseOrder: this.asteroid.Celestial.purchaseOrder,
      scanStatus: Asteroid.SCAN_STATUSES.RESOURCE_SCANNED,
      scanFinishTime: 0,
      bonuses: this.asteroid.Celestial.bonuses,
      abundances: packedAbundances
    });

    return { abundances: this.abundances };
  }

  getReturnValues() {
    return {
      asteroid: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      abundances: this.abundances,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  _generateAbundances() {
    // Generate pseudo-random abundances for each raw material, seeded by asteroid ID.
    // Values are 0-1000 (representing 0.000 to 1.000 abundance).
    // Use a simple LCG seeded by asteroid ID for deterministic results.
    const rawMaterials = Product.getListByClassification(Product.CLASSIFICATIONS.RAW_MATERIAL);
    let seed = this.asteroid.id;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (seed >>> 0) / 0xFFFFFFFF;
    };

    return rawMaterials.map(() => Math.floor(next() * 1000));
  }

  // eslint-disable-next-line class-methods-use-this
  _packAbundances(abundances) {
    // Pack abundances into a BigInt string matching the SDK's expected format.
    // Each abundance uses 10 bits, packed from LSB to MSB.
    let packed = 0n;
    for (let i = abundances.length - 1; i >= 0; i--) {
      packed = (packed << 10n) | BigInt(abundances[i]);
    }
    return packed.toString();
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ResourceScanFinished');
  }
}

module.exports = ScanResourcesFinishHandler;
