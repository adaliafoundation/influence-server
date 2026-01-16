const Entity = require('@common/lib/Entity');
const BaseHandler = require('../common/BridgeToStarknet');

class Handler extends BaseHandler {
  static eventName = 'BridgeToStarknet';

  processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    return super.processEvent(Entity.Ship(tokenId));
  }
}

module.exports = Handler;
