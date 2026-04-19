const { Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class RepossessBuildingHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'BuildingRepossessed'; }

  async validate() {
    const { building: buildingRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!buildingRef?.id) throw new ValidationError('vars.building with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.building = { id: buildingRef.id, label: Entity.IDS.BUILDING };

    this.buildingEntity = await EntityService.getEntity({
      id: buildingRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.buildingEntity) throw new ValidationError('Building not found');

    // Caller must control the underlying lot (or the asteroid, if the lot
    // inherits). Matches the on-chain repossession check.
    const lotRef = this.buildingEntity.Location?.location;
    if (lotRef?.label !== Entity.IDS.LOT) throw new ValidationError('Building is not on a lot');

    const lotControl = await ComponentService.findOneByEntity('Control', lotRef);
    let lotCrewId = lotControl?.controller?.id;
    if (!lotCrewId) {
      const asteroidRef = (this.buildingEntity.Location?.locations || [])
        .find((l) => l.label === Entity.IDS.ASTEROID);
      if (asteroidRef) {
        const asteroidControl = await ComponentService.findOneByEntity('Control', asteroidRef);
        lotCrewId = asteroidControl?.controller?.id;
      }
    }
    if (lotCrewId !== this.crew.id) {
      throw new ValidationError('Caller does not control the lot');
    }

    // Any active (non-cancelled) prepaid lease blocks repossession.
    this.activeLease = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': this.building.id,
      'entity.label': this.building.label,
      status: { $ne: 'CANCELLED' },
      endTime: { $gt: Math.floor(Date.now() / 1000) }
    });
    if (this.activeLease) {
      throw new ValidationError('Building has an active lease — cannot repossess until it expires');
    }
  }

  async applyStateChanges() {
    // Transfer Control of the building to the caller crew. The new
    // controller's crew = the lot owner (who is also the caller).
    await this.writeComponent('Control', {
      entity: this.building,
      controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
    });

    // Mark any stale (expired but not CANCELLED) prepaid lease as cancelled
    // so it doesn't linger on the building's policy stack.
    const staleLease = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': this.building.id,
      'entity.label': this.building.label,
      status: { $ne: 'CANCELLED' }
    }, { lean: false });
    if (staleLease) {
      staleLease.status = 'CANCELLED';
      await staleLease.save();
    }

    return {};
  }

  getReturnValues() {
    return {
      building: this.building,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/BuildingRepossessed');
  }
}

module.exports = RepossessBuildingHandler;
