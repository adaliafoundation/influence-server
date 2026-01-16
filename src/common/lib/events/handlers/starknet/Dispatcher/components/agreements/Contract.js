const mongoose = require('mongoose');
const { Address, Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService, PackedLotDataService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x436f6e747261637441677265656d656e74'
    ],
    name: 'ComponentUpdated_ContractAgreement'
  };

  async processEvent() {
    const { returnValues: { address, entity, permission } } = this.eventDoc;
    let updated = false;

    if (address === Address.toStandard(0, 'starknet')) {
      const { deletedCount } = await ComponentService.deleteOne({
        component: 'ContractAgreement',
        data: this.eventDoc.returnValues
      });
      if (deletedCount > 0) updated = true;
    } else {
      const { updated: _updated } = await ComponentService.updateOrCreateFromEvent({
        component: 'ContractAgreement',
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: true
      });

      updated = _updated;
    }

    if (!updated) return;
    await ElasticSearchService.queueEntityForIndexing(entity);

    if (permission === Permission.IDS.USE_LOT && Entity.isLot(entity)) {
      const cursor = mongoose.model('LocationComponent')
        .find({ 'entity.label': Entity.IDS.BUILDING, 'locations.uuid': Entity.toEntity(entity).uuid })
        .select('entity')
        .lean()
        .cursor();

      await Promise.all([
        ElasticSearchService.queueEntitiesForIndexing({ cursor }),
        PackedLotDataService.updateLotLeaseStatus(entity)
      ]);
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      permission: Number(data.shift()),
      permitted: this._entityFromUuid(data.shift()),
      address: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
