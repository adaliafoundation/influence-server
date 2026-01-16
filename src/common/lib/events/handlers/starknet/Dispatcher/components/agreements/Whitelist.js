const mongoose = require('mongoose');
const { Address, Permission } = require('@influenceth/sdk');
const { isString } = require('lodash');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService, PackedLotDataService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x57686974656c69737441677265656d656e74'
    ],
    name: 'ComponentUpdated_WhitelistAgreement'
  };

  async processEvent() {
    const { returnValues: { entity, permission, permitted, whitelisted } } = this.eventDoc;

    // determine the component doc to create/update
    const component = (isString(permitted)) ? 'WhitelistAccountAgreement' : 'WhitelistAgreement';
    let updated = false;

    if (whitelisted === false) {
      const { deletedCount } = await ComponentService.deleteOne({ component, data: this.eventDoc.returnValues });
      if (deletedCount > 0) updated = true;
    } else {
      const _temp = await ComponentService.updateOrCreateFromEvent({
        component,
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: true
      });

      updated = _temp.updated;
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

  static formatPermitted(value) {
    if (BigInt(value) < BigInt(2 ** 128) && Entity.fromUuid(value).isValid()) return this._entityFromUuid(value);
    return Address.toStandard(value, 'starknet');
  }

  // Transform the event data based on the number of data fields
  // WhitelistAccount (contract address) or standard whitelist (entity)
  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      permission: Number(data.shift()),
      permitted: this.formatPermitted(data.shift()),
      whitelisted: Boolean(Number(data.shift()))
    };
  }
}

module.exports = Handler;
