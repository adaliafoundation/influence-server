const { Address, Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService, PackedLotDataService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x436f6e7472616374506f6c696379'
    ],
    name: 'ComponentUpdated_ContractPolicy'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    let updated = false;
    let deleted = false;

    if (returnValues.address === Address.toStandard(0, 'starknet')) {
      const { deletedCount } = await ComponentService.deleteOne({ component: 'ContractPolicy', data: returnValues });
      if (deletedCount > 0) deleted = true;
    } else {
      const { updated: _updated } = await ComponentService.updateOrCreateFromEvent({
        component: 'ContractPolicy',
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: true
      });

      updated = _updated;
    }

    if (!updated && !deleted) return;

    await ElasticSearchService.queueEntityForIndexing(returnValues.entity);

    if (returnValues.permission === Permission.IDS.USE_LOT && Entity.isAsteroid(returnValues.entity)) {
      if (deleted) await PackedLotDataService.updateLotsToNonLeaseable({ asteroidEntity: returnValues.entity });
      if (updated) await PackedLotDataService.updateLotsToLeaseable({ asteroidEntity: returnValues.entity });
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      permission: Number(data.shift()),
      address: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
