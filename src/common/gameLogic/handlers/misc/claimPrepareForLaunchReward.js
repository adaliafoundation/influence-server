const { Entity } = require('@influenceth/sdk');
const BaseActionHandler = require('../BaseActionHandler');
const { ValidationError } = require('../../errors');

class ClaimPrepareForLaunchRewardHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepareForLaunchRewardClaimed'; }

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
      asteroid: this.asteroid,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/PrepareForLaunchRewardClaimed');
  }
}

module.exports = ClaimPrepareForLaunchRewardHandler;
