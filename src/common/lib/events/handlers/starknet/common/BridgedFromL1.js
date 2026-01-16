const { Address } = require('@influenceth/sdk');
const { uint256: { uint256ToBN } } = require('starknet');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  async processEvent(entity) {
    const { returnValues: { toAddress } } = this.eventDoc;
    const _entity = Entity.toEntity(entity);

    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': _entity.uuid });
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': _entity.uuid }, {
      bridge: {
        destination: CHAINS.STARKNET,
        origin: CHAINS.ETHEREUM,
        status: BRIDGING_STATES.COMPLETE
      },
      entity: _entity,
      event: ((nftCompDoc?.event?.timestamp || 0) < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        starknet: Address.toStandard(toAddress, 'starknet') // optimisticly set the starknet owner
      }
    });

    await ActivityService.findOrCreateOne({
      addresses: [toAddress],
      entities: [_entity],
      event: this.eventDoc
    });

    await ElasticSearchService.queueEntityForIndexing(_entity);
  }

  static transformEventData(event) {
    return {
      tokenId: Number(uint256ToBN({ low: event.data[0], high: event.data[1] })),
      toAddress: Address.toStandard(event.data[2], 'starknet')
    };
  }
}

module.exports = Handler;
