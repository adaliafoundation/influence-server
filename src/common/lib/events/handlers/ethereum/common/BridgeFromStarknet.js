const { Address } = require('@influenceth/sdk');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { ActivityService, ElasticSearchService, NftComponentService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  async processEvent(entity) {
    if (!entity) throw new Error('Entity is required');
    const _entity = Entity.toEntity(entity);

    const { returnValues: { l1Account, l2Account } } = this.eventDoc;

    const nftCompDoc = await NftComponentService.findOne({ '_entity.uuid': _entity.uuid });
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    await NftComponentService.updateOne({ 'entity.uuid': _entity.uuid }, {
      bridge: {
        destination: CHAINS.ETHEREUM,
        origin: CHAINS.STARKNET,
        status: BRIDGING_STATES.COMPLETE
      },
      entity,
      event: ((nftCompDoc?.event?.timestamp || 0) < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        ethereum: nftCompDoc?.owners?.ethereum || Address.toStandard(l1Account, 'ethereum'),
        starknet: nftCompDoc?.owners?.starknet // keep the starknet owner
      }
    });

    await ActivityService.findOrCreateOne({
      addresses: [Address.toStandard(l1Account, 'ethereum'), Address.toStandard(l2Account, 'starknet')],
      entities: [_entity],
      event: this.eventDoc
    });

    await ElasticSearchService.queueEntityForIndexing(_entity);
  }
}

module.exports = Handler;
