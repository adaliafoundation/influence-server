const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService, ComponentService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1dd6f5d3bcda83d7e82ecc8725717faedbe0543d04af18147b78fdb94ec6f25'],
    name: 'PrepaidAgreementTransferred'
  };

  async processEvent() {
    const { callerCrew, caller, oldPermitted, permission, permitted, target } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, oldPermitted, permitted, target],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // attempt to update the component document and set status to 'CANCELLED'
    const componentDoc = await ComponentService.findOne('PrepaidAgreementComponent', {
      'entity.uuid': Entity.toEntity(target).uuid,
      permission,
      'permitted.uuid': Entity.toEntity(oldPermitted).uuid
    }, { lean: false });

    if (componentDoc) {
      await componentDoc.updateToTransferred();
      await ElasticSearchService.queueEntityForIndexing(target);
    }

    this.addCrewRoomMessage(callerCrew.id);
    this.addCrewRoomMessage(permitted.id);
    this.addCrewRoomMessage(oldPermitted.id);

    // Notify the target's controller
    const targetControlCompDoc = await ComponentService.findOneByEntity('Control', target);
    if (targetControlCompDoc?.controller) this.addCrewRoomMessage(targetControlCompDoc.controller.id);
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      target: this._entityFromData(data),
      permission: Number(data.shift()),
      permitted: this._entityFromData(data),
      oldPermitted: this._entityFromData(data),
      term: Number(data.shift()),
      rate: Number(data.shift()),
      initialTerm: Number(data.shift()),
      noticePeriod: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
