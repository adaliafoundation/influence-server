const Entity = require('@common/lib/Entity');
const BaseHandler = require('../common/BridgeToStarknet');

class Handler extends BaseHandler {
  static eventName = 'BridgeToStarknet';

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    await super.processEvent(Entity.Asteroid(tokenId));
  }
}

module.exports = Handler;
