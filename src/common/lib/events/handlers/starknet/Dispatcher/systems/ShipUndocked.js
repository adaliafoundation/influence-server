const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x72de3827057a4cedd0ac04aec52fce94edec88aa651ae8fb6e4410b6aaf069'],
    name: 'ShipUndocked'
  };

  async processEvent() {
    const { returnValues: { dock, caller, callerCrew, ship } } = this.eventDoc;

    const crew = await EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true });

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [ship, dock, callerCrew],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    const [dockAsteroidEntity, dockLotEntity, shipAsteroidEntity, shipLotEntity] = await Promise.all([
      LocationComponentService.getAsteroidForEntity(dock),
      LocationComponentService.getLotForEntity(dock),
      LocationComponentService.getAsteroidForEntity(ship),
      LocationComponentService.getLotForEntity(ship)
    ]);

    // add messages
    this.messages.push({ to: `Crew::${callerCrew.id}` });
    if (dockAsteroidEntity) this.messages.push({ to: `Asteroid::${dockAsteroidEntity.id}` });
    if (shipAsteroidEntity) this.messages.push({ to: `Asteroid::${shipAsteroidEntity.id}` });

    // update packed lot data
    if (dockLotEntity) await PackedLotDataService.updateBuildingTypeForLot(dockLotEntity);
    if (shipLotEntity) await PackedLotDataService.updateBuildingTypeForLot(shipLotEntity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      dock: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
