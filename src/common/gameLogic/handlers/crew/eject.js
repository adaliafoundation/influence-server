const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CrewEjectHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'CrewEjected'; }

  async validate() {
    const { ejected_crew: ejectedRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!ejectedRef?.id) throw new ValidationError('vars.ejected_crew with id is required');

    // 1. Caller crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Caller crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Ejected crew must exist
    this.ejectedCrew = await EntityService.getEntity({
      id: ejectedRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.ejectedCrew) throw new ValidationError('Ejected crew not found');

    // 3. Both crews must be at the same station
    const callerStation = this.crew.Location?.location;
    const ejectedStation = this.ejectedCrew.Location?.location;
    if (!callerStation || !ejectedStation) {
      throw new ValidationError('Crews must be stationed at a location');
    }
    if (callerStation.id !== ejectedStation.id || callerStation.label !== ejectedStation.label) {
      throw new ValidationError('Crews are not at the same station');
    }

    this.station = callerStation;

    // 4. Caller must control the station (building/ship)
    const stationEntity = await EntityService.getEntity({
      id: this.station.id,
      label: this.station.label,
      components: ['Control'],
      format: true
    });
    if (stationEntity) {
      await AccessValidator.assertControlledBy(stationEntity, this.address);
    }
  }

  async applyStateChanges() {
    // Eject moves the crew to the asteroid (up one level in the location chain)
    const ejectedLocation = this.ejectedCrew.Location?.locations || [];
    const asteroid = ejectedLocation.find((l) => l.label === Entity.IDS.ASTEROID);
    if (!asteroid) throw new ValidationError('Cannot determine asteroid for ejection');

    await this.writeComponent('Location', {
      entity: { id: this.ejectedCrew.id, label: Entity.IDS.CREW },
      location: asteroid,
      locations: [asteroid]
    });

    return { ejectedCrewId: this.ejectedCrew.id };
  }

  getReturnValues() {
    return {
      station: this.station,
      ejectedCrew: this.vars.ejected_crew,
      finishTime: 0,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewEjected');
  }
}

module.exports = CrewEjectHandler;
