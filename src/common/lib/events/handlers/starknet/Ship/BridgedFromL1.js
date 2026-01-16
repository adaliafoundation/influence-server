const { CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../common/BridgedFromL1');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x1e27a21f2a2febcf4856da1a42f353e92351fc99ab9a5feb6d4170e91296923'],
    name: 'BridgedFromL1'
  };

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    const entity = Entity.Ship(tokenId);

    await super.processEvent(entity);

    await CrossingService.removeShipCrossing(tokenId, CHAINS.ETHEREUM, CHAINS.STARKNET);

    this.messages.push({ to: `Ship::${entity.id}` });
  }
}

module.exports = Handler;
