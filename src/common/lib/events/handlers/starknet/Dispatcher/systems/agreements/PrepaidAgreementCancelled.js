const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService, ComponentService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x5bf76b2a51e5780e089bc7d4f526e1d4577b7de423f281acb56a8c56d05704'],
    name: 'PrepaidAgreementCancelled'
  };

  async processEvent() {
    const { returnValues: { callerCrew, caller, permission, permitted, target } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, permitted, target],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // attempt to update the component document and set status to 'CANCELLED'
    const componentDoc = await ComponentService.findOne('PrepaidAgreementComponent', {
      'entity.uuid': Entity.toEntity(target).uuid,
      permission,
      'permitted.uuid': Entity.toEntity(permitted).uuid
    }, { lean: false });

    if (componentDoc) {
      await componentDoc.updateToCancelled();
      await ElasticSearchService.queueEntityForIndexing(target);
    }

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: `Crew::${permitted.id}` });

    // Notify the target's controller
    const targetControlCompDoc = await ComponentService.findOneByEntity('Control', target);
    if (targetControlCompDoc?.controller) this.messages.push({ to: `Crew::${targetControlCompDoc.controller.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      target: this._entityFromData(data),
      permission: Number(data.shift()),
      permitted: this._entityFromData(data),
      evictionTime: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
