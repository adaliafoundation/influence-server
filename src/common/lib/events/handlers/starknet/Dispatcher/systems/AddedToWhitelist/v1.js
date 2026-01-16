const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x96b70f4bdeade9dfe2b3672f89a74547e057ead2a80df2ef987299ec7402ab'],
    name: 'AddedToWhitelistV1',
    baseName: 'AddedToWhitelist',
    version: 1
  };

  async processEvent() {
    const { returnValues: { entity, callerCrew, caller, permitted } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [entity, callerCrew, permitted],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${callerCrew.id}` });
    this.messages.push({ to: `Crew::${permitted.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      entity: this._entityFromData(data),
      permission: Number(data.shift()),
      permitted: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
