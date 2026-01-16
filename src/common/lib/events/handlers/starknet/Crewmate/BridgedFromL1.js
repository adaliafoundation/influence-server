const Entity = require('@common/lib/Entity');
const { CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const BaseHandler = require('../common/BridgedFromL1');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x1e27a21f2a2febcf4856da1a42f353e92351fc99ab9a5feb6d4170e91296923'],
    name: 'BridgedFromL1'
  };

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    const entity = Entity.Crewmate(tokenId);

    await super.processEvent(entity);

    // The bridge process is complete at this point, drop the related crossing document (if exists)
    await CrossingService.removeCrewmateCrossing(tokenId, CHAINS.ETHEREUM, CHAINS.STARKNET);

    this.messages.push({ to: `CREWMATE::${entity.id}` });
  }
}

module.exports = Handler;
