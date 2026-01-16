const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1de5b52f13bbea30a28267ce799155da75b34d786ae026260de1d2e24aea303'],
    name: 'LotLeased'
  };

  async processEvent() {
    const { returnValues: { asteroid, callerCrew, caller, lot } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew, lot],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      lot: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
