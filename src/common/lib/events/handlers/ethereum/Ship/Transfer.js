const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventName = 'Transfer';

  async processEvent() {
    const { returnValues: { from, tokenId, to: owner } } = this.eventDoc;
    const entity = Entity.Ship(tokenId);

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': entity.uuid });
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': entity.uuid }, {
      entity,
      event: (nftCompDoc?.event?.timestamp < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        ethereum: Address.toStandard(owner, 'ethereum'),
        starknet: nftCompDoc?.owners?.starknet // keep the starknet owner
      }
    });

    await ActivityService.findOrCreateOne({ addresses: [from, owner], entities: [entity], event: this.eventDoc });

    await ElasticSearchService.queueEntityForIndexing(entity);
    this.messages.push({ to: `Ship::${entity.id}`, body: { entities: [entity] } });
  }
}

module.exports = Handler;
