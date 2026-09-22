const { pullAt, range } = require('lodash');
const { Address } = require('@influenceth/sdk');
const { ComponentService, ElasticSearchService } = require('@common/services');

const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x43726577'
    ],
    name: 'ComponentUpdated_Crew'
  };

  async processEvent() {
    const { returnValues: { entity, readyAt } } = this.eventDoc;

    const data = { ...this.eventDoc.returnValues };
    const crewComponentDoc = await ComponentService.findOneByEntity('Crew', entity);
    if (!crewComponentDoc) {
      data.lastReadyAt = readyAt;
    } else if (readyAt > crewComponentDoc.readyAt) {
      data.lastReadyAt = crewComponentDoc.readyAt;
    }

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Crew',
      event: this.eventDoc,
      data,
      replace: true
    });

    if (!updated) return;
    if (crewComponentDoc?.delegatedTo !== Address.toStandard(data.delegatedTo)
      || JSON.stringify(crewComponentDoc?.roster) !== JSON.stringify(data.roster)) {
      this.addCrewRoomMessage(entity);
    }
    await ElasticSearchService.queueEntityForIndexing(entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      delegatedTo: Address.toStandard(data.shift(), 'starknet'),
      roster: pullAt(data, range(0, Number(data.shift()))).map(Number),
      lastFed: Number(data.shift()),
      readyAt: Number(data.shift()),
      actionType: Number(data.shift()),
      actionTarget: this._entityFromData(data),
      actionRound: Number(data.shift()),
      actionWeight: Number(data.shift())
    };
  }
}

module.exports = Handler;
