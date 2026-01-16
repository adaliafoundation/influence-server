const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x5c0c06fec1df373ca8334cb2d2ea7c16a008b1d1c559a91ae0c548ae8304a6'],
    name: 'LotReclaimed'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, lot } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, lot],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(lot);
    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      lot: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
