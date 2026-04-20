const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class CrewExchangeHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'CrewmatesExchanged'; }

  async validate() {
    const { crew1: crew1Ref, comp1, _crew2: crew2Ref, comp2 } = this.vars || {};
    if (!crew1Ref?.id) throw new ValidationError('vars.crew1 with id is required');
    if (!crew2Ref?.id) throw new ValidationError('vars._crew2 with id is required');
    if (!Array.isArray(comp1)) throw new ValidationError('vars.comp1 must be an array');
    if (!Array.isArray(comp2)) throw new ValidationError('vars.comp2 must be an array');

    // 1. Both crews must exist and be controlled by this address
    this.crew1 = await EntityService.getEntity({
      id: crew1Ref.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew1) throw new ValidationError('Crew 1 not found');
    await AccessValidator.assertControlledBy(this.crew1, this.address);

    this.crew2 = await EntityService.getEntity({
      id: crew2Ref.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew2) throw new ValidationError('Crew 2 not found');
    await AccessValidator.assertControlledBy(this.crew2, this.address);

    // 2. Both crews must be at the same location
    const loc1 = this.crew1.Location?.location;
    const loc2 = this.crew2.Location?.location;
    if (!loc1 || !loc2 || loc1.id !== loc2.id || loc1.label !== loc2.label) {
      throw new ValidationError('Crews must be at the same location to exchange crewmates');
    }

    // 3. New compositions must contain the same total crewmates as the old ones
    this.oldRoster1 = this.crew1.Crew?.roster || [];
    this.oldRoster2 = this.crew2.Crew?.roster || [];
    const allOld = new Set([...this.oldRoster1, ...this.oldRoster2].map(Number));
    const allNew = new Set([...comp1, ...comp2].map(Number));
    if (allOld.size !== allNew.size || ![...allOld].every((id) => allNew.has(id))) {
      throw new ValidationError('New compositions must redistribute the same crewmates');
    }
  }

  async applyStateChanges() {
    const newRoster1 = this.vars.comp1.map(Number);
    const newRoster2 = this.vars.comp2.map(Number);

    // Sync readyAt to the latest of both crews
    const latestReadyAt = Math.max(this.crew1.Crew.readyAt || 0, this.crew2.Crew.readyAt || 0);

    await this.writeComponent('Crew', {
      entity: { id: this.crew1.id, label: Entity.IDS.CREW },
      roster: newRoster1,
      lastFed: this.crew1.Crew.lastFed,
      readyAt: latestReadyAt,
      delegatedTo: this.crew1.Crew.delegatedTo
    });

    await this.writeComponent('Crew', {
      entity: { id: this.crew2.id, label: Entity.IDS.CREW },
      roster: newRoster2,
      lastFed: this.crew2.Crew.lastFed,
      readyAt: latestReadyAt,
      delegatedTo: this.crew2.Crew.delegatedTo
    });

    return { crew1Id: this.crew1.id, crew2Id: this.crew2.id };
  }

  getReturnValues() {
    return {
      crew1: this.vars.crew1,
      crew1CompositionOld: this.oldRoster1.map((id) => ({ id, label: Entity.IDS.CREWMATE })),
      crew1CompositionNew: this.vars.comp1.map((id) => ({ id: Number(id), label: Entity.IDS.CREWMATE })),
      crew2: this.vars._crew2,
      crew2CompositionOld: this.oldRoster2.map((id) => ({ id, label: Entity.IDS.CREWMATE })),
      crew2CompositionNew: this.vars.comp2.map((id) => ({ id: Number(id), label: Entity.IDS.CREWMATE })),
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewmatesExchanged');
  }
}

module.exports = CrewExchangeHandler;
