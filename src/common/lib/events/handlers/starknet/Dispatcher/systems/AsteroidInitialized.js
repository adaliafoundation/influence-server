const logger = require('@common/lib/logger');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const { ComponentService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2e65d90dc2974dd57dcce4de22c68225729eac6fb80cfe2e0b0a70063c2fc12'],
    name: 'AsteroidInitialized'
  };

  async processEvent() {
    const { returnValues: { asteroid: entity } } = this.eventDoc;

    // Update the AsteroidProof doc, set used to true and clear the proof
    await ComponentService.updateOrCreateFromEvent({
      component: 'AsteroidProof',
      event: this.eventDoc,
      data: { entity, proof: [], used: true }
    });

    await ElasticSearchService.queueEntityForIndexing(entity);

    try {
      await updateAsteroidAsset({ id: entity.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data)
    };
  }
}

module.exports = Handler;
