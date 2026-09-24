const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x556e69717565'
    ],
    name: 'ComponentUpdated_Unique'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;
    if (!returnValues.entity) return;

    // Keep cleared tenancy as a null value so older events cannot restore it.
    const { updated, oldDoc } = await ComponentService.updateOrCreateFromEvent({
      component: 'UseLot',
      event: this.eventDoc,
      data: { ...returnValues },
      replace: true
    });
    if (!updated) return;

    const lot = Entity.toEntity(returnValues.entity);
    await ElasticSearchService.queueEntityForIndexing(lot);
    this.messages.push({ to: this.getRoomFromEntity(lot) });
    this.addAsteroidRoomMessage(lot.unpackLot().asteroidEntity);
    if (oldDoc?.tenant) this.addCrewRoomMessage(oldDoc.tenant);
    if (returnValues.tenant) this.addCrewRoomMessage(returnValues.tenant);
  }

  static transformEventData(event) {
    const [pathLength, namespace, lot, tenant] = event.data;
    // Unique also stores occupancy and unrelated markers; only UseLot is tenancy.
    if (Number(pathLength) !== 2 || BigInt(namespace) !== 0x5573654c6f74n) return {};

    return {
      entity: this._entityFromUuid(lot),
      tenant: BigInt(tenant) === 0n ? null : this._entityFromUuid(tenant)
    };
  }
}

module.exports = Handler;
