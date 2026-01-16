const { Address } = require('@influenceth/sdk');
const { ActivityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');
const { hashKeys: hashKeysV0 } = require('./ShipAssemblyStarted/v0');
const { hashKeys: hashKeysV1 } = require('./ShipAssemblyStarted/v1');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x34ebc82341a3486c93a0e714f6c7f2b4127e01685c4034ab9053fa2350e84b3'],
    name: 'ShipAssemblyFinished'
  };

  async processEvent() {
    const { caller, callerCrew, destination, dryDock, ship } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, destination, dryDock, ship],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys
    });

    if (activityResult?.created === 0) return;

    const { status } = await ActivityService.resolveStartActivity('ShipAssemblyStarted', this.eventDoc, hashKeysV0);
    if (status === 'NOT_FOUND') {
      await ActivityService.resolveStartActivity('ShipAssemblyStarted', this.eventDoc, hashKeysV1);
    }

    const [dryDockAsteroidEntity, dryDockLotEntity, shipAsteroidEntity, shipLotEntity] = await Promise.all([
      LocationComponentService.getAsteroidForEntity(dryDock),
      LocationComponentService.getLotForEntity(dryDock),
      LocationComponentService.getAsteroidForEntity(ship),
      LocationComponentService.getLotForEntity(ship)
    ]);

    // add messages
    this.messages.push({ to: `Crew::${callerCrew.id}` });
    if (dryDockAsteroidEntity) this.messages.push({ to: `Asteroid::${dryDockAsteroidEntity.id}` });
    if (shipAsteroidEntity) this.messages.push({ to: `Asteroid::${shipAsteroidEntity.id}` });

    // update packed lot data
    if (dryDockLotEntity) await PackedLotDataService.updateBuildingTypeForLot(dryDockLotEntity);
    if (shipLotEntity) await PackedLotDataService.updateBuildingTypeForLot(shipLotEntity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      dryDock: this._entityFromData(data),
      dryDockSlot: Number(data.shift()),
      destination: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
