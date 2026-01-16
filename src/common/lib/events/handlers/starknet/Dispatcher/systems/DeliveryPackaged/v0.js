const { Address } = require('@influenceth/sdk');
const {
  ActivityService,
  ComponentService,
  CrewmateService,
  CrewService,
  EntityService,
  LocationComponentService } = require('@common/services');
const Logger = require('@common/lib/logger');
const StarknetBaseHandler = require('../../../Handler');
const { extractInventories } = require('../../../utils');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1efe5ac10a84b083d3cf71bfff793dd83198ce7ef9a5426b1b30d9b81935aa3'],
    name: 'DeliveryPackaged'
  };

  async processEvent() {
    const { callerCrew, caller, dest, delivery, origin } = this.eventDoc.returnValues;
    const data = {};

    const results = await Promise.allSettled([
      EntityService.getEntity({ ...callerCrew, components: ['Crew', 'Location'], format: true }),
      CrewmateService.findByCrew(callerCrew),
      CrewService.findStation(callerCrew),
      ComponentService.findOneByEntity('Control', dest)
    ]);

    if (results[0].value) data.crew = results[0].value;
    if (results[1].value) data.crewmates = results[1].value;
    if (results[2].value) data.station = results[2].value;

    const unresolvedFor = [callerCrew];
    if (results[3]?.value?.controller) unresolvedFor.push(results[3].value.controller);

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      data,
      entities: [callerCrew, dest, delivery, origin],
      event: this.eventDoc,
      hashKeys: ['name', 'returnValues.delivery.id'],
      unresolvedFor
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      const destAsteroidEntity = await LocationComponentService.getAsteroidForEntity(dest);
      const originAsteroidEntity = await LocationComponentService.getAsteroidForEntity(origin);
      if (destAsteroidEntity) this.messages.push({ to: `Asteroid::${destAsteroidEntity.id}` });
      if (originAsteroidEntity) this.messages.push({ to: `Asteroid::${originAsteroidEntity.id}` });
    } catch (error) {
      Logger.warn(error);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      origin: this._entityFromData(data),
      originSlot: Number(data.shift()),
      products: extractInventories(data),
      dest: this._entityFromData(data),
      destSlot: Number(data.shift()),
      delivery: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
