const { hash } = require('starknet');
const { Address } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const { felt, subjectRoom } = require('@common/lib/missions');
const BaseHandler = require('../../Handler');

const createHandler = (name) => class extends BaseHandler {
  static eventConfig = { keys: [hash.getSelectorFromName(name)], name };

  static transformEventData(event) {
    const reward = name === 'MissionRewardClaimed';
    if (event.data.length !== (reward ? 6 : 4)) throw new Error(`Invalid ${name} payload`);
    const [campaign, label, id, mission, recipient, amount] = event.data;
    const index = Number(felt(mission));
    if (!Number.isInteger(index) || index > 0xffffffff) throw new Error('Invalid mission index');
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('Invalid subject ID');
    const subject = { label: Number(label), id: Number(id) };
    subjectRoom(subject);
    if (reward && BigInt(felt(amount)) >= 2n ** 128n) throw new Error('Invalid reward amount');
    return {
      campaign: felt(campaign),
      subject,
      mission: index,
      ...(reward ? { recipient: Address.toStandard(recipient, 'starknet'), amount: felt(amount) } : {})
    };
  }

  async processEvent() {
    const { subject, recipient } = this.eventDoc.returnValues;
    await ActivityService.findOrCreateOne({
      entities: [subject], addresses: recipient ? [recipient] : [], event: this.eventDoc
    });
    this.messages.push({ to: this.getRoomFromEntity(subject) });
    if (recipient) this.messages.push({ to: recipient });
  }
};

module.exports = {
  MissionAccepted: createHandler('MissionAccepted'),
  MissionCompleted: createHandler('MissionCompleted'),
  MissionRewardClaimed: createHandler('MissionRewardClaimed')
};
