const { Address } = require('@influenceth/sdk');
const { ActivityService, ComponentService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x1eea89a1e6b4107f4a1b3a2cb213a10967bda1938f2c8ae3926ac089f36be4c'],
    name: 'PrepaidAgreementExtended'
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
