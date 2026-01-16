const { Address } = require('@influenceth/sdk');
const { pullAt, range } = require('lodash');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys } = require('./ResourceScanStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2f6e8eecbf460f39568068b9758116354b4cc857aa448c1eda56b9dd090599'],
    name: 'ResourceScanFinished'
  };

  async processEvent() {
    const { returnValues: { asteroid, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('ResourceScanStarted', this.eventDoc, hashKeys);

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      abundances: pullAt(data, range(0, Number(data.shift()))).map(Number),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
