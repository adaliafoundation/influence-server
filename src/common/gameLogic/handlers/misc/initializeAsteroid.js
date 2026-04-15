const { Entity } = require('@influenceth/sdk');
const BaseActionHandler = require('../BaseActionHandler');
const { ValidationError } = require('../../errors');

class InitializeAsteroidHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'AsteroidInitialized'; }

  async validate() {
    const { asteroid: asteroidRef } = this.vars || {};
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    this.asteroid = { id: asteroidRef.id, label: Entity.IDS.ASTEROID };
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
