const { pullAt } = require('lodash');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const { ComponentService, ElasticSearchService, NftComponentService } = require('@common/services');
const logger = require('@common/lib/logger');
const BaseHandler = require('../../Handler');
const { Fixed } = require('../../utils');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x43656c65737469616c'
    ],
    name: 'ComponentUpdated_Celestial'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;
    const { doc: newDoc, oldDoc, updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Celestial',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (!updated) return;
    await ElasticSearchService.queueEntityForIndexing(entity);

    // Flag the entity for card update if bonuses, scanStatus or purchaseOrder changed
    if (
      !oldDoc
      || newDoc.bonuses !== oldDoc.bonuses
      || newDoc.scanStatus !== oldDoc.scanStatus
      || newDoc.purchaseOrder !== oldDoc.purchaseOrder
    ) {
      await NftComponentService.flagForCardUpdate(entity);

      try {
        await updateAsteroidAsset({ id: entity.id });
      } catch (error) {
        logger.warn(JSON.stringify(error));
      }
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      celestialType: Number(data.shift()),
      mass: Fixed.toFixed(pullAt(data, 0, 1)).valueOf(), // mass in tonnes
      radius: Fixed.toFixed(pullAt(data, 0, 1)).valueOf(), // radius in km
      purchaseOrder: Number(data.shift()),
      scanStatus: Number(data.shift()),
      scanFinishTime: Number(data.shift()),
      bonuses: Number(data.shift()), // in bonus order either true or false
      abundances: data.shift() // abundances in resource type order in thousandths
    };
  }
}

module.exports = Handler;
