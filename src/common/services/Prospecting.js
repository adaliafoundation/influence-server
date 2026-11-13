const mongoose = require('mongoose');
const { Address, Entity } = require('@influenceth/sdk');

const campaignId = (value) => {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid campaign ID');
  const id = BigInt(value);
  if (!id || id >= 2n ** 64n) throw new Error('Invalid campaign ID');
  return id.toString();
};
class ProspectingService {
  static async get(id) {
    const key = campaignId(id);
    const campaign = await mongoose.model('ProspectingCampaignComponent').findOne({ campaignId: key }).lean();
    if (!campaign) return null;
    const samples = await mongoose.model('ProspectingCoreComponent').find({ campaignId: key })
      .sort({ index: 1 }).lean();
    return { campaign, samples };
  }

  static async list({ owner, originId, page = 1 }) {
    if (!owner || !/^(0x[0-9a-f]+)$/i.test(owner)) throw new Error('An owner address is required');
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page');
    const filter = { creator: Address.toStandard(owner, 'starknet') };
    if (originId !== undefined) {
      const id = Number(originId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid origin lot');
      filter['origin.uuid'] = Entity.packEntity({ label: Entity.IDS.LOT, id });
    }
    const size = 50;
    const campaigns = await mongoose.model('ProspectingCampaignComponent').find(filter)
      .sort({ 'event.timestamp': -1, campaignId: -1 }).skip((page - 1) * size)
      .limit(size + 1)
      .lean();
    return { campaigns: campaigns.slice(0, size), page, hasMore: campaigns.length > size };
  }
}
module.exports = ProspectingService;
