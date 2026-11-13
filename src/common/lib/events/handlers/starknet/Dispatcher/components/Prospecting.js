const { hash, shortString } = require('starknet');
const { ComponentService, ElasticSearchService } = require('@common/services');
const { COMPONENTS, decodeComponent } = require('@common/lib/prospecting');
const BaseHandler = require('../../Handler');

const createHandler = (name) => class extends BaseHandler {
  static eventConfig = {
    keys: [hash.getSelectorFromName('ComponentUpdated'), shortString.encodeShortString(name)],
    name: `ComponentUpdated_${name}`
  };

  static transformEventData(event) { return decodeComponent(name, event); }

  async processEvent() {
    const data = this.eventDoc.returnValues;
    const { updated } = await ComponentService.updateOrCreateFromEvent({ component: name, event: this.eventDoc, data });
    if (!updated) return;
    if (data.entity) {
      await ElasticSearchService.queueEntityForIndexing(data.entity);
      this.messages.push({ to: this.getRoomFromEntity(data.entity) });
    }
    if (data.crew) this.addCrewRoomMessage(data.crew);
  }
};

module.exports = Object.fromEntries(Object.keys(COMPONENTS)
  .map((name) => [`ComponentUpdated${name}`, createHandler(name)]));
