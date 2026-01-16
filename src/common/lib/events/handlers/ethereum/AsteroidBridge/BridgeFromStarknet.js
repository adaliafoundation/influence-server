const { CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../common/BridgeFromStarknet');

class Handler extends BaseHandler {
  static eventName = 'BridgeFromStarknet';

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    const entity = Entity.Asteroid(tokenId);

    await super.processEvent(entity);

    // The bridge process is complete at this point, drop the related crossing document (if exists)
    await CrossingService.removeAsteroidCrossing(tokenId, CHAINS.STARKNET, CHAINS.ETHEREUM);
  }
}

module.exports = Handler;
