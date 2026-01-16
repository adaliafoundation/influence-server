/**
 * This is a deprecated event handler but may need to remain for historical purposes.
 */
const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');
const { hashKeys } = require('../DeliveryStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3435a9d95091a672245626e7bf4498099e7ef34a89ad07d9525edff7462bdb0'],
    name: 'DeliveryFinished'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, delivery } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, delivery],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('DeliveryStarted', this.eventDoc, hashKeys);
    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      delivery: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
