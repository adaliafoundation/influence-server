const { hash, shortString } = require('starknet');
const { ComponentService } = require('@common/services');
const { cellData, subjectFromUuid, subjectRoom } = require('@common/lib/missions');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [hash.getSelectorFromName('ComponentUpdated'), shortString.encodeShortString('Mission')],
    name: 'ComponentUpdated_Mission'
  };

  static transformEventData(event) {
    const count = Number(event.data[0]);
    if (!Number.isSafeInteger(count) || count < 1 || event.data.length !== count + 2) {
      throw new Error('Invalid Mission component payload');
    }
    return cellData(event.data.slice(1, count + 1), event.data[count + 1]);
  }

  async processEvent() {
    const data = this.eventDoc.returnValues;
    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Mission', event: this.eventDoc, data
    });
    if (!updated) return;
    if (data.subjectUuid) {
      const subject = subjectFromUuid(data.subjectUuid);
      this.messages.push({ to: subjectRoom(subject) });
    } else if (['Definition', 'DefinitionCount'].includes(data.namespace)) {
      this.messages.push({});
    }
  }
}

module.exports = Handler;
