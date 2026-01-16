const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  LocationComponentService,
  PackedLotDataService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3d94a2aa6975b0c38fa5b048430a3db4f32efb5d2a54ad2a4b85a17224b090d'],
    name: 'ConstructionStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.building.id'
  ];

  async processEvent() {
    const { building, callerCrew, caller } = this.eventDoc.returnValues;
    const data = {};

    const results = await Promise.allSettled([
      EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true }),
      CrewmateService.findByCrew(callerCrew),
      CrewService.findStation(callerCrew)
    ]);

    if (results[0].value) data.crew = results[0].value;
    if (results[1].value) data.crewmates = results[1].value;
    if (results[2].value) data.station = results[2].value;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data,
      entities: [building, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'Construction',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    const locationComponentDoc = await LocationComponentService.findOneByEntity(building);
    const asteroidEntity = locationComponentDoc?.getAsteroidLocation();
    const lotEntity = locationComponentDoc?.getLotLocation();

    if (asteroidEntity) this.messages.push({ to: `Asteroid::${asteroidEntity.id}` });

    if (lotEntity) await PackedLotDataService.updateBuildingTypeForLot(lotEntity);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      building: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
