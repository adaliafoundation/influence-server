const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { uint256: { uint256ToBN } } = require('starknet');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9'],
    name: 'Transfer'
  };

  async processEvent() {
    const { returnValues: { from, tokenId, to: owner } } = this.eventDoc;
    const entity = Entity.Crewmate(tokenId);

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': entity.uuid });
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': entity.uuid }, {
      entity,
      event: (nftCompDoc?.event?.timestamp < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        ethereum: nftCompDoc?.owners?.ethereum, // keep the ethereum owner
        starknet: Address.toStandard(owner, 'starknet')
      }
    });

    await ActivityService.findOrCreateOne({
      addresses: [from, owner],
      entities: [entity],
      event: this.eventDoc
    });

    await ElasticSearchService.queueEntityForIndexing(entity);
    this.messages.push({ to: `Crewmate::${entity.id}`, body: { entities: [entity] } });
    this.messages.push({ to: from, body: { entities: [entity] } });
    this.messages.push({ to: owner, body: { entities: [entity] } });
  }

  static transformEventData(event) {
    return {
      from: Address.toStandard(event.data[0], 'starknet'),
      to: Address.toStandard(event.data[1], 'starknet'),
      tokenId: Number(uint256ToBN({ low: event.data[2], high: event.data[3] }))
    };
  }
}

module.exports = Handler;
