const { Address, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ManageAsteroidHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'AsteroidManaged'; }

  async validate() {
    const { asteroid: asteroidRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.asteroid = { id: asteroidRef.id, label: Entity.IDS.ASTEROID };

    // Caller must be the asteroid NFT owner. Cairo enforces this with
    // `nft::assert_owner('Asteroid', asteroid, context.caller)` at
    // manage_asteroid.cairo:39 — without this check any crew could
    // register as manager of someone else's asteroid.
    const nft = await ComponentService.findOneByEntity('Nft', this.asteroid);
    const ownerAddress = nft?.owners?.starknet || nft?.owners?.ethereum;
    if (!ownerAddress) throw new ValidationError('Asteroid has no recorded owner');
    if (Address.toStandard(ownerAddress) !== Address.toStandard(this.address)) {
      throw new ValidationError('Not authorized: caller is not the asteroid owner');
    }

    // Idempotency: don't emit AsteroidManaged when the crew is already
    // in control.
    const existingControl = await ComponentService.findOneByEntity('Control', this.asteroid);
    if (existingControl?.controller) {
      const currentController = EntityLib.toEntity(existingControl.controller);
      const crewEntity = EntityLib.toEntity(this.crew);
      if (currentController.uuid === crewEntity.uuid) {
        throw new ValidationError('Crew already manages this asteroid');
      }
    }
  }

  async applyStateChanges() {
    // Actually perform the management handoff — write Control pointing
    // at the caller's crew. Was a no-op before.
    await this.writeComponent('Control', {
      entity: this.asteroid,
      controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
    });
    return {};
  }

  getReturnValues() {
    return {
      asteroid: this.asteroid,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidManaged');
  }
}

module.exports = ManageAsteroidHandler;
