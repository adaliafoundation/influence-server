const { pullAt, range } = require('lodash');
const { Address } = require('@influenceth/sdk');
const { CrewReadyNotificationService, NftComponentService } = require('@common/services');

const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    baseName: 'ComponentUpdated_Crew',
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x43726577',
      '0x1'
    ],
    name: 'ComponentUpdated_Crew_V1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { entity, readyAt } } = this.eventDoc;

    // Get the current CrewComponent doc
    // If found and if the new readyAt is greater than the current readyAt, set lastReadyAt to the current readyAt.
    // If not found, set lastReadyAt to the new readyAt. Both values will be the same in this case.
    const data = { ...this.eventDoc.returnValues };
    const crewComponentDoc = await ComponentService.findOneByEntity('Crew', entity);
    if (!crewComponentDoc) {
      data.lastReadyAt = readyAt;
    } else if (readyAt > crewComponentDoc.readyAt) {
      data.lastReadyAt = crewComponentDoc.readyAt;
    }

    const { doc: newDoc, oldDoc, updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Crew',
      event: this.eventDoc,
      data,
      replace: true
    });

    if (!updated) return;

    // create or update the CrewReadyNotification
    await CrewReadyNotificationService.createOrUpdate({ crew: entity, readyAt });

    // queue the entity for indexing
    await ElasticSearchService.queueEntityForIndexing(entity);

    if (!oldDoc || JSON.stringify(newDoc.roster || []) !== JSON.stringify(oldDoc.roster || [])) {
      await NftComponentService.flagForCardUpdate(entity);
    }
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
      actionWeight: Number(data.shift()),
      actionStrategy: Number(data.shift())
    };
  }
}

module.exports = Handler;
