const { pullAt, range } = require('lodash');
const logger = require('@common/lib/logger');
const Entity = require('@common/lib/Entity');
const { Address } = require('@influenceth/sdk');
const { updateCrewmateAsset } = require('@common/lib/marketplaces');
const { getPurchasePrice } = require('@common/lib/Crewmate');
const {
  ActivityService,
  ComponentService,
  LocationComponentService,
  PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x179b7a0a16b428b78d4022a646fb56419a593ebb6694a48704f0cb49c602f56'],
    name: 'CrewmateRecruited'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, crewmate, station } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, crewmate, station],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    try {
      await updateCrewmateAsset({ id: crewmate.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }

    const stationEntity = new Entity(station);
    if (!stationEntity.isAsteroid()) {
      const lotEntity = await LocationComponentService.getLotForEntity(stationEntity);
      if (lotEntity) await PackedLotDataService.updateLotCrewStatus(lotEntity);
    }

    // Create (only) an InternalSale component for the crewmate
    try {
      const crewmatePurchasePrice = await getPurchasePrice(crewmate.id);

      await ComponentService.createOnlyFromEvent({
        component: 'InternalSale',
        event: this.eventDoc,
        data: {
          entity: Entity.Crewmate(crewmate.id),
          price: crewmatePurchasePrice
        }
      });
    } catch (error) {
      logger.warn(`Error creating InternalSale component: ${error.message}`);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      crewmate: this._entityFromData(data),
      coll: Number(data.shift()),
      class: Number(data.shift()),
      title: Number(data.shift()),
      impactful: pullAt(data, range(0, Number(data.shift()))).map(Number),
      cosmetic: pullAt(data, range(0, Number(data.shift()))).map(Number),
      gender: Number(data.shift()),
      body: Number(data.shift()),
      face: Number(data.shift()),
      hair: Number(data.shift()),
      hairColor: Number(data.shift()),
      clothes: Number(data.shift()),
      head: Number(data.shift()),
      item: Number(data.shift()),
      station: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
