const { Asteroid, Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class ScanResourcesStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ResourceScanStarted'; }

  async validate() {
    const { asteroid: asteroidRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

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

    // 2. Asteroid must be SURFACE_SCANNED
    this.asteroid = await EntityService.getEntity({
      id: asteroidRef.id,
      label: Entity.IDS.ASTEROID,
      components: ['Celestial'],
      format: true
    });
    if (!this.asteroid) throw new ValidationError('Asteroid not found');
    if (this.asteroid.Celestial?.scanStatus !== Asteroid.SCAN_STATUSES.SURFACE_SCANNED) {
      throw new ValidationError('Asteroid must be surface-scanned before resource scanning');
    }

    // 3. Crew must control the asteroid
    const asteroidControl = await ComponentService.findOne('Control', {
      'entity.id': asteroidRef.id,
      'entity.label': Entity.IDS.ASTEROID
    });
    if (!asteroidControl || asteroidControl.controller.id !== callerCrewRef.id) {
      throw new ValidationError('Crew does not control this asteroid');
    }
  }

  async applyStateChanges() {
    this.finishTime = this.now + await this.gameSecondsToReal(Asteroid.SCANNING_TIME);

    await this.writeComponent('Celestial', {
      entity: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      celestialType: this.asteroid.Celestial.celestialType,
      mass: this.asteroid.Celestial.mass,
      radius: this.asteroid.Celestial.radius,
      purchaseOrder: this.asteroid.Celestial.purchaseOrder,
      scanStatus: Asteroid.SCAN_STATUSES.RESOURCE_SCANNING,
      scanFinishTime: this.finishTime,
      bonuses: this.asteroid.Celestial.bonuses,
      abundances: this.asteroid.Celestial.abundances || ''
    });

    await this.setCrewBusy(this.crew, this.finishTime);

    return { finishTime: this.finishTime };
  }

  getReturnValues() {
    return {
      asteroid: { id: this.asteroid.id, label: Entity.IDS.ASTEROID },
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ResourceScanStarted');
  }
}

module.exports = ScanResourcesStartHandler;
