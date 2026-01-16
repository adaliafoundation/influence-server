const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { ActivityService, CrossingService, ElasticSearchService, NftComponentService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  /**
   * Uses the starknet owner (which is set by the Starknet transfer event) to determine the bridge status
   * If the starknet owner is empty or owned by the bridge contract, the bridge is still processing
   * @param {NftComponentDocument} nftCompDoc
   * @returns String
   */
  getBridgeStatus(nftCompDoc) {
    if ([
      null,
      undefined,
      appConfig.get('Contracts.starknet.asteroid'),
      appConfig.get('Contracts.starknet.crewmate'),
      Address.toStandard('0', 'starknet')].includes(nftCompDoc?.owners?.starknet)) {
      return BRIDGING_STATES.PROCESSING;
    }
    return BRIDGING_STATES.COMPLETE;
  }

  async processEvent(entity) {
    if (!entity) throw new Error('entityLabel is required');
    const _entity = Entity.toEntity(entity);

    const { returnValues: { l1Account, l2Account } } = this.eventDoc;
    const shallowEvent = { id: this.eventDoc._id, timestamp: this.eventDoc.timestamp };
    const nftCompDoc = await NftComponentService.findOne({ 'entity.uuid': _entity.uuid });
    const update = {
      bridge: {
        destination: CHAINS.STARKNET,
        origin: CHAINS.ETHEREUM,
        status: this.getBridgeStatus(nftCompDoc)
      },
      entity: _entity,
      event: ((nftCompDoc?.event?.timestamp || 0) < this.eventDoc.timestamp)
        ? shallowEvent : (nftCompDoc?.event || shallowEvent),
      owners: {
        ethereum: nftCompDoc?.owners?.ethereum, // keep the ethereum owner
        starknet: Address.toStandard(l2Account, 'starknet') // optimisticly set the starknet owner
      }
    };

    await NftComponentService.updateOne({ 'entity.uuid': _entity.uuid }, update);

    // attempt to update the corrsponding crossing doc with the l1 account (fromAddress)
    await CrossingService.updateOne({
      assetIds: { $in: [_entity.id] },
      assetTypes: _entity.label,
      destination: CHAINS.STARKNET,
      fromAddress: null
    }, { fromAddress: l1Account });

    await ActivityService.findOrCreateOne({
      addresses: [l1Account, l2Account],
      entities: [_entity],
      event: this.eventDoc
    });

    await ElasticSearchService.queueEntityForIndexing(_entity);
  }
}

module.exports = Handler;
