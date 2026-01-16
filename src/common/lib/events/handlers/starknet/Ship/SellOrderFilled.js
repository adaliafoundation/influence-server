const Entity = require('@common/lib/Entity');
const { uint256: { uint256ToBN } } = require('starknet');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x2df90525e8a75383064e68e37c015a4ed0f4156903c24f300427a6be559f4d8'],
    name: 'SellOrderFilled'
  };

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc.toObject();
    const entity = Entity.Ship(tokenId);

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': entity.uuid });
    const owner = nftCompDoc.owners?.starknet;

    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': entity.uuid }, {
      entity,
      event: (nftCompDoc?.event?.timestamp < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      price: 0
    });

    await ActivityService.findOrCreateOne({ addresses: [owner], entities: [entity], event: this.eventDoc });

    await ElasticSearchService.queueEntityForIndexing(entity);
    this.messages.push({ to: `Ship::${tokenId}`, body: { entities: [entity] } });
    this.messages.push({ to: owner, body: { entities: [entity] } });
  }

  static transformEventData(event) {
    return {
      tokenId: Number(uint256ToBN({ low: event.data[0], high: event.data[1] })),
      price: Number(event.data[2])
    };
  }
}

module.exports = Handler;
