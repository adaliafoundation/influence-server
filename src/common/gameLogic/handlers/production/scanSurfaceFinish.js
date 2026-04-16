const { Asteroid, Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ScanSurfaceFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'SurfaceScanFinished'; }

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

    // 2. Asteroid must be SURFACE_SCANNING and scan must be finished
    this.asteroid = await EntityService.getEntity({
      id: asteroidRef.id,
      label: Entity.IDS.ASTEROID,
      components: ['Celestial'],
      format: true
    });
    if (!this.asteroid) throw new ValidationError('Asteroid not found');
    if (this.asteroid.Celestial?.scanStatus !== Asteroid.SCAN_STATUSES.SURFACE_SCANNING) {
      throw new ValidationError('Asteroid is not currently surface scanning');
    }
    StateMachineValidator.assertFinished(this.asteroid.Celestial, 'Surface scan', 'scanFinishTime');
  }

  async applyStateChanges() {
    // Generate random bonuses (packed as a single number)
    // In hybrid mode, use a deterministic seed based on asteroid ID
    this.bonuses = this._generateBonuses();

    await this.writeComponent('Celestial', {
      entity: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      celestialType: this.asteroid.Celestial.celestialType,
      mass: this.asteroid.Celestial.mass,
      radius: this.asteroid.Celestial.radius,
      purchaseOrder: this.asteroid.Celestial.purchaseOrder,
      scanStatus: Asteroid.SCAN_STATUSES.SURFACE_SCANNED,
      scanFinishTime: 0,
      bonuses: this.bonuses,
      abundances: this.asteroid.Celestial.abundances || ''
    });

    return { bonuses: this.bonuses };
  }

  getReturnValues() {
    return {
      asteroid: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      bonuses: this.bonuses,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  _generateBonuses() {
    // Generate a pseudo-random bonuses value seeded by asteroid ID.
    // Bonuses encode lot-level bonus types for the asteroid's lots.
    // For hybrid mode a simple deterministic value is sufficient.
    const seed = this.asteroid.id * 2654435761; // Knuth multiplicative hash
    return Math.abs(seed) % (2 ** 32);
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/SurfaceScanFinished');
  }
}

module.exports = ScanSurfaceFinishHandler;
