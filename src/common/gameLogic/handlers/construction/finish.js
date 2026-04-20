const { Building, Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const StateMachineValidator = require('../../validators/stateMachine');
const { ValidationError } = require('../../errors');

class ConstructionFinishHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ConstructionFinished'; }

  async validate() {
    const { building: buildingRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!buildingRef?.id) throw new ValidationError('vars.building with id is required');
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');

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

    // 2. Building must exist and be UNDER_CONSTRUCTION
    this.building = await EntityService.getEntity({
      id: buildingRef.id,
      label: Entity.IDS.BUILDING,
      components: ['Building', 'Location', 'Control'],
      format: true
    });
    if (!this.building) throw new ValidationError('Building not found');
    StateMachineValidator.assertStatus(
      this.building.Building,
      Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION,
      'Building'
    );

    // 3. Construction must be finished (finishTime has passed)
    StateMachineValidator.assertFinished(this.building.Building, 'Building');
  }

  async applyStateChanges() {
    // Update building status to OPERATIONAL
    await this.writeComponent('Building', {
      entity: { id: this.building.id, label: Entity.IDS.BUILDING },
      buildingType: this.building.Building.buildingType,
      status: Building.CONSTRUCTION_STATUSES.OPERATIONAL,
      plannedAt: this.building.Building.plannedAt,
      finishTime: this.building.Building.finishTime
    });

    return { buildingId: this.building.id };
  }

  getReturnValues() {
    return {
      building: { id: this.building.id, label: Entity.IDS.BUILDING },
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionFinished');
  }
}

module.exports = ConstructionFinishHandler;
