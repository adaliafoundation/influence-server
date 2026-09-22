const { hash, shortString } = require('starknet');
const { ComponentService } = require('@common/services');
const { decodeComponent } = require('@common/lib/missionBindings');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [hash.getSelectorFromName('ComponentUpdated'), shortString.encodeShortString('ProcessType')],
    name: 'ComponentUpdated_ProcessType'
  };

  static transformEventData(event) {
    const { path, data } = decodeComponent('ProcessType', event);
    return { processId: path[0], definition: data };
  }

  async processEvent() {
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'ProcessType', event: this.eventDoc, data: this.eventDoc.returnValues
    });
    if (updated) this.messages.push({});
  }
}

module.exports = Handler;
