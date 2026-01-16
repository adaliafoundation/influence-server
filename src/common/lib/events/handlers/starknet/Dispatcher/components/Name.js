const { shortString } = require('starknet');
const { ComponentService, ElasticSearchService, NftComponentService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4e616d65'
    ],
    name: 'ComponentUpdated_Name'
  };

  async processEvent() {
    const { returnValues: { entity, name } } = this.eventDoc;
    let updated;

    // check for empty name (name === '0'), which mean the name component should be deleted
    if (name === '0') {
      const { deletedCount } = await ComponentService.deleteOne({
        component: 'Name',
        data: this.eventDoc.returnValues
      });
      if (deletedCount > 0) updated = true;
    } else {
      ({ updated } = await ComponentService.updateOrCreateFromEvent({
        component: 'Name',
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: true
      }));
    }

    if (!updated) return;

    await Promise.all([
      NftComponentService.flagForCardUpdate(entity, true),
      ElasticSearchService.queueEntityForIndexing(entity),
      ElasticSearchService.queueRelatedEntitiesForIndexing(entity)
    ]);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      name: shortString.decodeShortString(data.shift())
    };
  }
}

module.exports = Handler;
