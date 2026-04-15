const BaseActionHandler = require('../BaseActionHandler');
const { ValidationError } = require('../../errors');

class DirectMessageHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DirectMessageSent'; }

  async validate() {
    const { recipient, content_hash: contentHash } = this.vars || {};
    if (!recipient) throw new ValidationError('vars.recipient is required');

    this.recipient = recipient;
    // contentHash may be an array of shortstring chunks — join them
    this.contentHash = Array.isArray(contentHash) ? contentHash.join('') : (contentHash || '');
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      recipient: this.recipient,
      contentHash: this.contentHash,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DirectMessageSent');
  }
}

module.exports = DirectMessageHandler;
