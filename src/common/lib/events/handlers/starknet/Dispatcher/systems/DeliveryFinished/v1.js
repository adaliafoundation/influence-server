/**
 * This is a deprecated event handler but may need to remain for historical purposes.
 */
const { Address } = require('@influenceth/sdk');
const { ActivityService, EntityService, LocationComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');
const { extractInventories } = require('../../../utils');
const { hashKeys } = require('../DeliveryStarted');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    baseName: 'DeliveryFinished',
    keys: ['0x2f8c5f77848593cc361c90dbd6f569ebd9acdc61eb315b0ccb7515dca1e1f8f'],
    name: 'DeliveryFinishedV1',
    version: 1
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, dest, delivery, origin } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, delivery],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    await ActivityService.resolveStartActivity('DeliveryStarted', this.eventDoc, hashKeys);

    // load the destination and origin entities
    const [destEntity, originEntity, destAsteroidEntity, originAsteroidEntity] = await Promise.allSettled([
      EntityService.getEntity({ ...dest, components: ['Control'], format: true }),
      EntityService.getEntity({ ...origin, components: ['Control'], format: true }),
      LocationComponentService.getAsteroidForEntity(dest),
      LocationComponentService.getAsteroidForEntity(origin)
    ]);

    // add WS messages
    this.addCrewRoomMessage(callerCrew);
    if (destEntity.value?.Control?.controller) this.addCrewRoomMessage(destEntity.value.Control.controller);
    if (originEntity.value?.Control?.controller) this.addCrewRoomMessage(originEntity.value.Control.controller);
    if (destAsteroidEntity.value) this.addAsteroidRoomMessage(destAsteroidEntity.value);
    if (originAsteroidEntity.value) this.addAsteroidRoomMessage(originAsteroidEntity.value);
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
