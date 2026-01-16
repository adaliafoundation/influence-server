const Entity = require('@common/lib/Entity');
const { uint256: { uint256ToBN } } = require('starknet');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x258bdf4f1e869ce324d405a5c9a25758a84c1e9bb6a527ba767d16fce4fcb8a'],
    name: 'SellOrderSet'
  };

  async processEvent() {
    const { returnValues: { tokenId, price } } = this.eventDoc.toObject();
    const entity = Entity.Ship(tokenId);

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': entity.uuid });
    const owner = nftCompDoc.owners?.starknet;

    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': entity.uuid }, {
      entity,
      event: (nftCompDoc?.event?.timestamp < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      price: Number(price)
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
