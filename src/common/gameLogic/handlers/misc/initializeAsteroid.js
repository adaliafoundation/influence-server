const { Entity } = require('@influenceth/sdk');
const { ComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const { ValidationError } = require('../../errors');

class InitializeAsteroidHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'AsteroidInitialized'; }

  async validate() {
    const { asteroid: asteroidRef } = this.vars || {};
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    this.asteroid = { id: asteroidRef.id, label: Entity.IDS.ASTEROID };

    // Cairo (systems/seeding/initialize_asteroid.cairo) gates this action
    // on a merkle-proof check against ASTEROID_MERKLE_ROOT so arbitrary
    // clients can't seed fake Celestial data. In hybrid we have no
    // merkle root — the forkWorld + seed scripts are the only legitimate
    // source of Celestial data — so we refuse to run this action as an
    // online endpoint. The asteroid must already exist with a Celestial
    // component in the database; if it does, accept as a no-op so
    // composite actions (InitializeAndManageAsteroid) can pass through.
    const existing = await ComponentService.findOneByEntity('Celestial', this.asteroid);
    if (!existing) {
      throw new ValidationError(
        'Asteroid must be seeded server-side before it can be initialized'
      );
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      asteroid: this.asteroid
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidInitialized');
  }
}

module.exports = InitializeAsteroidHandler;
