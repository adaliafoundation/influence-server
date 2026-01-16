const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xeb76905f1b628cd78b8bf307a363ddbb9ed0a0f3f9558ae0d3ec24ae3be534'],
    name: 'CrewDelegated'
  };

  async processEvent() {
    const { returnValues: { caller, crew, delegatedTo } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller, delegatedTo],
      entities: [crew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: delegatedTo });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      delegatedTo: Address.toStandard(data.shift(), 'starknet'),
      crew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
