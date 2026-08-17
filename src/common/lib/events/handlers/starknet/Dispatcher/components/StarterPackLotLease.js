const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');
const { entityFromPathValue, readPath } = require('./starterUtils');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x537461727465725061636b4c6f744c65617365'
    ],
    name: 'ComponentUpdated_StarterPackLotLease'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'StarterPackLotLease',
      event: this.eventDoc,
      data: { ...returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(returnValues.entity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    const [targetPath, permission, permittedPath] = readPath(data);

    return {
      entity: entityFromPathValue(targetPath),
      permission: Number(permission),
      permitted: entityFromPathValue(permittedPath),
      crew: this._entityFromData(data)
    };
  }
}

module.exports = Handler;
