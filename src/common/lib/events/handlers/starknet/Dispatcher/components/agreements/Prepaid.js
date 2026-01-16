const mongoose = require('mongoose');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const {
  ComponentService,
  ElasticSearchService,
  PackedLotDataService,
  LeaseExpirationNotificationService } = require('@common/services');
const logger = require('@common/lib/logger');
const BaseHandler = require('../../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x5072657061696441677265656d656e74'
    ],
    name: 'ComponentUpdated_PrepaidAgreement'
  };

  async processEvent() {
    const { returnValues: { endTime, entity, permission, permitted, startTime } } = this.eventDoc;
    let updated;

    if (endTime === 0 && startTime === 0) {
      const { deletedCount } = await ComponentService.deleteOne({
        component: 'PrepaidAgreement',
        data: { ...this.eventDoc.returnValues }
      });
      if (deletedCount > 0) updated = true;
    } else {
      const result = await ComponentService.updateOrCreateFromEvent({
        component: 'PrepaidAgreement',
        event: this.eventDoc,
        data: { ...this.eventDoc.returnValues },
        replace: false // do not replace the document, we do not want to overwrite the status
      });

      // if the new endTime is greater than the previous endTime and status is not null, clear the status
      if (result.updated && result.oldDoc?.endTime < endTime && result.oldDoc?.status) {
        logger.info(`Resetting status for PrepaidAgreementComponent, entity: ${entity.uuid}, 
          permission: ${permission}, permitted: ${permitted.uuid}, current status: ${result.oldDoc.status}`);
        await result.doc.resetStatus();
      }

      updated = result.updated;
    }

    if (!updated) return;

    await LeaseExpirationNotificationService.createOrUpdate({ entity, endTime, permission, permitted });

    await ElasticSearchService.queueEntityForIndexing(entity);

    if (permission === Permission.IDS.USE_LOT && Entity.isLot(entity)) {
      const cursor = mongoose.model('LocationComponent')
        .find({ 'entity.label': Entity.IDS.BUILDING, 'locations.uuid': Entity.toEntity(entity).uuid })
        .select('entity')
        .lean()
        .cursor();

      await Promise.all([
        ElasticSearchService.queueEntitiesForIndexing({ cursor }),
        PackedLotDataService.updateLotLeaseStatus(entity)
      ]);
    }
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      permission: Number(data.shift()),
      permitted: this._entityFromUuid(data.shift()),
      rate: Number(data.shift()), // rate in SWAY / Adalian day (IRL hour)
      initialTerm: Number(data.shift()), // initial term in Adalian days (0 makes it open ended)
      noticePeriod: Number(data.shift()), // notice in Adalian days
      startTime: Number(data.shift()), // time of agreement start
      endTime: Number(data.shift()), // time of end based on payments
      noticeTime: Number(data.shift()) // time of notice
    };
  }
}

module.exports = Handler;
