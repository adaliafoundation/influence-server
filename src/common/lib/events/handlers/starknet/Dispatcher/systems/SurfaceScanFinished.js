const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys } = require('./SurfaceScanStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x23cc9226fdd840c3fd4175d945b5089eeb0cf8525853efa3299d69edd1fe458'],
    name: 'SurfaceScanFinished'
  };

  async processEvent() {
    const { returnValues: { asteroid, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('SurfaceScanStarted', this.eventDoc, hashKeys);

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      await updateAsteroidAsset({ id: asteroid.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      bonuses: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
