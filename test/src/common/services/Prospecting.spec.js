const { expect } = require('chai');
const mongoose = require('mongoose');
const { Address, Entity, Lot } = require('@influenceth/sdk');
const Prospecting = require('@common/services/Prospecting');
const handlers = require('@common/lib/events/handlers/starknet/Dispatcher');

const owner = Address.toStandard('0x123', 'starknet');
const originId = Lot.toId(1, 1);

describe('Prospecting history', function () {
  const id = '18446744073709551615';

  afterEach(function () {
    return this.utils.resetCollections(['ProspectingCampaignComponent', 'ProspectingCoreComponent', 'Starknet']);
  });

  it('indexes campaign-scoped components and returns ordered cores without entity IDs', async function () {
    const insert = async (Handler, data, logIndex) => {
      const event = await mongoose.model('Starknet').create(Handler.parseEvent({
        data,
        blockNumber: 10,
        blockHash: '0x123',
        transactionIndex: 1,
        logIndex,
        transactionHash: '0xabc',
        timestamp: 1000
      }));
      await new Handler(event).processEvent();
    };
    await insert(
      handlers.ComponentUpdatedProspectingCampaign,
      ['1', id, '1', '9', owner, '4', String(originId), '1', '123', '0',
        '10000', '0x456', '2', '0', '4', '9999', '7', '99'],
      0
    );
    for (const index of [1, 0]) {
      await insert(
        handlers.ComponentUpdatedProspectingCore,
        ['2', id, String(index), '123', '1', '999', '0', '777', '100', '200'],
        index + 1
      );
    }
    const result = await Prospecting.get(id);
    expect(result.campaign.campaignId).to.equal(id);
    expect(result.campaign).not.to.have.property('entity');
    expect(result.campaign.origin.uuid).to.equal(Entity.packEntity({ label: 4, id: originId }));
    expect(result.campaign.claim).to.include({ id: 99, label: 7 });
    expect(result.samples.map((sample) => sample.index)).to.deep.equal([0, 1]);
    expect(result.samples[0].commitment).to.equal((2n ** 128n + 123n).toString());
    const history = await Prospecting.list({ owner: '0x123', originId });
    expect(history.campaigns.map((campaign) => campaign.campaignId)).to.deep.equal([id]);
    expect((await Prospecting.list({ owner: '0x789', originId })).campaigns).to.have.lengthOf(0);
  });

  it('paginates history and validates public identifiers', async function () {
    await mongoose.model('ProspectingCampaignComponent').create(Array.from({ length: 51 }, (_, index) => ({
      campaignId: String(index + 1),
      creator: owner,
      origin: { label: 4, id: originId },
      event: { timestamp: index + 1 }
    })));
    const first = await Prospecting.list({ owner, originId });
    const second = await Prospecting.list({ owner, originId, page: 2 });
    expect(first.campaigns).to.have.lengthOf(50);
    expect(first.hasMore).to.equal(true);
    expect(second.campaigns.map((campaign) => campaign.campaignId)).to.deep.equal(['1']);
    expect(second.hasMore).to.equal(false);
    for (const invalid of ['0', '1e3', '18446744073709551616']) {
      try { await Prospecting.get(invalid); throw new Error('Invalid ID accepted'); } catch (error) {
        expect(error.message).to.equal('Invalid campaign ID');
      }
    }
  });
});
