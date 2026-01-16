const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const { updateAsteroidAsset } = require('@common/lib/marketplaces');
const {
  ActivityService,
  CrewmateService,
  CrewService,
  EntityService,
  ResolvableEventNotificationService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x2ad9f01f5d941d8ec8c8ef8922e07913abf0dcc31a68da6f25c95498ac336'],
    name: 'SurfaceScanStarted'
  };

  static hashKeys = [
    'name',
    'returnValues.asteroid.id'
  ];

  async processEvent() {
    const { asteroid, callerCrew, caller } = this.eventDoc.returnValues;
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
      entities: [asteroid, callerCrew],
      event: this.eventDoc,
      hashKeys: Handler.hashKeys,
      unresolvedFor: [callerCrew]
    });

    if (activityResult?.created === 0) return;

    await ResolvableEventNotificationService.createOrUpdate({
      type: 'SurfaceScan',
      event: this.eventDoc,
      activity: activityResult.doc
    });

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      await updateAsteroidAsset({ id: asteroid.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      finishTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
