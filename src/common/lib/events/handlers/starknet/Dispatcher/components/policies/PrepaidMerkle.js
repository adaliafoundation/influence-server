const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x507265706169644d65726b6c65506f6c696379'
    ],
    name: 'ComponentUpdated_PrepaidMerklePolicy'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    let updated = false;

    if (
      returnValues.rate === 0 && returnValues.initialTerm === 0
      && returnValues.noticePeriod === 0 && returnValues.merkleRoot === 0
    ) {
      const { deletedCount } = await ComponentService.deleteOne({
        component: 'PrepaidMerklePolicy',
        data: returnValues
      });
      if (deletedCount > 0) updated = true;
    } else {
      const { updated: _updated } = await ComponentService.updateOrCreateFromEvent({
        component: 'PrepaidMerklePolicy',
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: true
      });

      updated = _updated;
    }

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      permission: Number(data.shift()),
      rate: Number(data.shift()),
      initialTerm: Number(data.shift()),
      noticePeriod: Number(data.shift()),
      merkleRoot: data.shift()
    };
  }
}

module.exports = Handler;
