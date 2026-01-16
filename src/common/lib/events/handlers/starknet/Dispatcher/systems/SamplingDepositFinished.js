const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys: hashKeysV0 } = require('./SamplingDepositStarted/v0');
const { hashKeys: hashKeysV1 } = require('./SamplingDepositStarted/v1');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xdea1c9ee79718f2f48439c3733220d7003e7e7a0428c07c2e86106378a2553'],
    name: 'SamplingDepositFinished'
  };

  async processEvent() {
    const { returnValues: { deposit, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [deposit, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys
    });

    if (activityResult?.created === 0) return;

    const { status } = await ActivityService.resolveStartActivity(
      'SamplingDepositStarted',
      this.eventDoc,
      hashKeysV0
    );
    if (status === 'NOT_FOUND') {
      await ActivityService.resolveStartActivity('SamplingDepositStarted', this.eventDoc, hashKeysV1);
    }

    this.messages.push({ to: `Crew::${this.eventDoc.returnValues.callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      deposit: this._entityFromData(data),
      initialYield: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
