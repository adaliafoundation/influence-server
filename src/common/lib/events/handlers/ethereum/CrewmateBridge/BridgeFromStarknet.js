const Entity = require('@common/lib/Entity');
const { CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const BaseHandler = require('../common/BridgeFromStarknet');

class Handler extends BaseHandler {
  static eventName = 'BridgeFromStarknet';

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;

    await super.processEvent(Entity.Crewmate(tokenId));

    // The bridge process is complete at this point, drop the related crossing document (if exists)
    await CrossingService.removeCrewmateCrossing(tokenId, CHAINS.STARKNET, CHAINS.ETHEREUM);
  }
}

module.exports = Handler;
