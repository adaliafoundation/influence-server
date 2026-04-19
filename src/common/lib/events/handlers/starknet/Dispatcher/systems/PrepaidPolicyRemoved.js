const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0xd513ef8bb6ec70b2429eb7621d1985bde43e6deaee591e8ed3600a5156b2c2'],
    name: 'PrepaidPolicyRemoved'
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [entity, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // Same fan-out as PrepaidPolicyAssigned: owner crew + asteroid room so
    // other crews' lot-browser views refresh without a manual reload.
    this.messages.push({ to: `Crew::${callerCrew.id}` });
    const targetLocation = await LocationComponentService.findOneByEntity(entity);
    const asteroidEntity = targetLocation?.getAsteroidLocation?.();
    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      permission: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
