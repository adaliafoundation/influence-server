const { Address } = require('@influenceth/sdk');
const { ActivityService, ComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1928520880bbb1833193302f1fcae60ad75dcba8de37daaf33db4f5f3d1626c'],
    name: 'ContractAgreementAccepted'
  };

  async processEvent() {
    const { callerCrew, caller, permitted, target } = this.eventDoc.returnValues;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, permitted, target],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

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
      contract: Address.toStandard(data.shift(), 'starknet'),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
