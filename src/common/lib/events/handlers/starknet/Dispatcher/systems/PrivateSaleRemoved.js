const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x6699be2da254a6509029773b2f897db3b8e68dea8eb075300dc806f733d6ba'],
    name: 'PrivateSaleRemoved'
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller } } = this.eventDoc;
    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [entity, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
