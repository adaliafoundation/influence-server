const { hash } = require('starknet');
const { ActivityService } = require('@common/services');
const { decodeEvent } = require('@common/lib/prospecting');
const BaseHandler = require('../../Handler');

const createHandler = (name) => class extends BaseHandler {
  static eventConfig = { keys: [hash.getSelectorFromName(name)], name };

  static transformEventData(event) { return decodeEvent(name, event); }

  async processEvent() {
    const data = this.eventDoc.returnValues;
    const entities = [data.origin, data.lot, data.deposit, data.callerCrew].filter(Boolean);
    await ActivityService.findOrCreateOne({ entities, addresses: [data.caller], event: this.eventDoc });
    this.addCrewRoomMessage(data.callerCrew);
    for (const lot of [data.origin, data.lot].filter(Boolean)) this.messages.push({ to: this.getRoomFromEntity(lot) });
  }
};
module.exports = Object.fromEntries(['ProspectingCampaignStarted', 'ProspectingSampleCommitted',
  'ProspectingCampaignFinalized', 'ProspectingCampaignAbandoned'].map((name) => [name, createHandler(name)]));
