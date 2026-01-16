const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1df32a6baafac1721488087818d69d739dc9360233126d938df8d2c8bec758d'],
    name: 'ExchangeConfigured'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, exchange } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, exchange],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(exchange);
    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      exchange: { label: Number(data.shift()), id: Number(data.shift()) },
      callerCrew: { label: Number(data.shift()), id: Number(data.shift()) },
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
