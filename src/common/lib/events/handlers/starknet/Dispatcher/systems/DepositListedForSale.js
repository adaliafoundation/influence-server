const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x117b64b3d3507afa9a065b0c4d78690b6daacbca1869898273fddede8f757b4'],
    name: 'DepositListedForSale'
  };

  async processEvent() {
    const { callerCrew, caller, deposit } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, deposit],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // Fan-out: owner crew + the asteroid the deposit sits on, so other
    // players browsing that asteroid's deposits see the listing without
    // a refresh. Same pattern as the policy handlers.
    this.messages.push({ to: `Crew::${callerCrew.id}` });
    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(deposit);
    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      deposit: this._entityFromData(data),
      price: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
