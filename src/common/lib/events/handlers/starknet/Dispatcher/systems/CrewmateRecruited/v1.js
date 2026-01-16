const { pullAt, range } = require('lodash');
const { shortString } = require('starknet');
const logger = require('@common/lib/logger');
const Entity = require('@common/lib/Entity');
const { Address } = require('@influenceth/sdk');
const { getPurchasePrice } = require('@common/lib/Crewmate');
const { updateCrewmateAsset } = require('@common/lib/marketplaces');
const {
  ActivityService,
  ComponentService,
  LocationComponentService,
  PackedLotDataService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'CrewmateRecruited',
    keys: ['0x2bf4e6a806f632e88c4113d82d4ad0ab4ab2c62bffa0b657a6fb602f495a63a'],
    name: 'CrewmateRecruitedV1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, composition, crewmate, station } } = this.eventDoc;
    const stationEntity = new Entity(station);
    const stationLocationComponentDoc = await LocationComponentService.findOneByEntity(stationEntity);

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, crewmate, station, stationLocationComponentDoc?.getAsteroidLocation()],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });

    // Push message to user if this crew is new
    if (composition.length === 1) this.messages.push({ to: caller });

    try {
      await updateCrewmateAsset({ id: crewmate.id });
    } catch (error) {
      logger.warn(JSON.stringify(error));
    }

    if (!stationEntity.isAsteroid() && stationLocationComponentDoc) {
      const lotEntity = stationLocationComponentDoc.getLotLocation();
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
      name: shortString.decodeShortString(data.shift()),
      station: this._entityFromData(data),
      composition: pullAt(data, range(0, Number(data.shift()))).map(Number),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
