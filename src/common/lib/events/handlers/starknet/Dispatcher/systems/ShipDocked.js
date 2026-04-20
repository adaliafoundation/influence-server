const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService, PackedLotDataService } = require('@common/services');
const { isHybrid } = require('@common/lib/gameMode');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2f1a45f05257acc3061a63d573e1f707318bf8f10f64a9c2dcbd2731ed07dba'],
    name: 'ShipDocked'
  };

  async processEvent() {
    const { returnValues: { ship, dock, callerCrew, caller } } = this.eventDoc;

    const crew = await EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true });

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data: { crew },
      entities: [ship, dock, callerCrew],
      event: this.eventDoc
    });

    // In hybrid mode, the game engine writes Location components but the
    // derived crew-location chain may not be fully resolved by component events.
    if (isHybrid()) {
      await LocationComponentService.refreshCrewLocationsAtLocation(ship);
    }

    if (activityResult?.created === 0) return;

    const shipLocationComponentDoc = await LocationComponentService.findOneByEntity(ship);
    const shipAsteroidEntity = shipLocationComponentDoc?.getAsteroidLocation();
    const shipLotEntity = shipLocationComponentDoc?.getLotLocation();

    // add messages
    this.messages.push({ to: `Crew::${callerCrew.id}` });
    if (shipAsteroidEntity) this.messages.push({ to: `Asteroid::${shipAsteroidEntity.id}` });

    // update packed lot data
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
