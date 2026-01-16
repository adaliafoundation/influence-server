const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1085a37d58e6a75db0dadc9bb9e6707ed9c5630aec61fdcdcd832decec751c0'],
    name: 'BuildingRepossessed'
  };

  async processEvent() {
    const { building, callerCrew, caller } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [building, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(building);
    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });

    // Update specific activity items connected to the previous owner
    await ActivityService.updateDeliveryPackagedUnresolvedFor(callerCrew, building);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      building: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
