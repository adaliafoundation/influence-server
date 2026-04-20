const BaseActionHandler = require('../BaseActionHandler');
const { ValidationError } = require('../../errors');

class RekeyInboxHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'RekeyedInbox'; }

  async validate() {
    const { x, y } = this.vars || {};
    if (!x || !y) throw new ValidationError('vars.x and vars.y (messaging keys) are required');

    this.messagingKeyX = x;
    this.messagingKeyY = y;
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      messagingKeyX: this.messagingKeyX,
      messagingKeyY: this.messagingKeyY,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/RekeyedInbox');
  }
}

module.exports = RekeyInboxHandler;
