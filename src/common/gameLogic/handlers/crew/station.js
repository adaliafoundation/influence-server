const { Entity, Permission } = require('@influenceth/sdk');
const { EntityService, LocationComponentService } = require('@common/services');
const EntityLib = require('@common/lib/Entity');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class CrewStationHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'CrewStationed'; }

  async validate() {
    const { destination: destRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Crew must be ready
    CrewValidator.assertReady(this.crew);

    // 3. Destination must exist
    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location', 'Control'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    // 4. Must have STATION_CREW permission on the destination
    await AccessValidator.assertPermission(this.crew, this.destination, Permission.IDS.STATION_CREW);

    // 5. Capture origin station from crew's current location
    this.originStation = this.crew.Location?.location || null;
  }

  async applyStateChanges() {
    const destRef = this.vars.destination;
    const destEntity = EntityLib.toEntity(destRef);
    const fullLocation = await LocationComponentService.getFullLocation(destEntity);

    // Update crew's location to the destination
    await this.writeComponent('Location', {
      entity: { id: this.crew.id, label: Entity.IDS.CREW },
      location: destEntity.toObject(),
      locations: fullLocation
    });

    return { crewId: this.crew.id };
  }

  getReturnValues() {
    return {
      originStation: this.originStation || { id: 0, label: 0 },
      destinationStation: this.vars.destination,
      finishTime: 0,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewStationed/v1');
  }
}

module.exports = CrewStationHandler;
