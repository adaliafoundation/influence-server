const { pullAt, range } = require('lodash');

const { ComponentService, ElasticSearchService, NftComponentService } = require('@common/services');
const { updateCrewmateAsset } = require('@common/lib/marketplaces');
const logger = require('@common/lib/logger');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x437265776d617465'
    ],
    name: 'ComponentUpdated_Crewmate'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;
    const { doc: newDoc, oldDoc, updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Crewmate',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (!updated) return;
    await ElasticSearchService.queueEntityForIndexing(entity);

    // Flag the entity for card update if appearance, class, coll or title changed
    if (
      !oldDoc
      || newDoc.appearance !== oldDoc.appearance
      || newDoc.class !== oldDoc.class
      || newDoc.coll !== oldDoc.coll
      || newDoc.title !== oldDoc.title
    ) {
      await NftComponentService.flagForCardUpdate(entity, true);

      try {
        await updateCrewmateAsset({ id: entity.id });
      } catch (error) {
        logger.warn(JSON.stringify(error));
      }
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      status: Number(data.shift()),
      coll: Number(data.shift()),
      class: Number(data.shift()),
      title: Number(data.shift()),
      appearance: data.shift(), // 128bit packed value stored as hex string
      cosmetic: pullAt(data, range(0, Number(data.shift()))).map(Number),
      impactful: pullAt(data, range(0, Number(data.shift()))).map(Number)
    };
  }
}

module.exports = Handler;
