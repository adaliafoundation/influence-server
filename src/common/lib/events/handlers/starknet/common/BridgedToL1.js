const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { uint256: { uint256ToBN } } = require('starknet');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  async processEvent(entity) {
    if (!entity) throw new Error('Entity is required');
    const _entity = Entity.toEntity(entity);

    const { returnValues: { fromAddress, toAddress } } = this.eventDoc;

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': _entity.uuid });
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': _entity.uuid }, {
      bridge: {
        destination: CHAINS.ETHEREUM,
        origin: CHAINS.STARKNET,
        status: BRIDGING_STATES.PROCESSING
      },
      entity: _entity,
      event: ((nftCompDoc?.event?.timestamp || 0) < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        ethereum: nftCompDoc?.owners?.ethereum || Address.toStandard(toAddress, 'ethereum'),
        starknet: nftCompDoc?.owners?.starknet || Address.toStandard(fromAddress, 'starknet')
      }
    });

    await ActivityService.findOrCreateOne({
      addresses: [fromAddress, toAddress],
      entities: [_entity],
      event: this.eventDoc
    });

    await ElasticSearchService.queueEntityForIndexing(_entity);
  }

  static transformEventData(event) {
    return {
      tokenId: Number(uint256ToBN({ low: event.data[0], high: event.data[1] })),
      fromAddress: Address.toStandard(event.data[2], 'starknet'),
      toAddress: Address.toStandard(event.data[3], 'ethereum')
    };
  }
}

module.exports = Handler;
