const { expect } = require('chai');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/OffchainCrewmateGranted');

describe('OffchainCrewmateGranted Handler', function () {
  let event;

  beforeEach(async function () {
    const data = [
      '0xabc', '0x123', '0x2', '0x99', '0x4', '0x3', '0x0',
      '0x1', '0xa', '0x3', '0xb', '0xc', '0xd',
      '0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x0', '0x0',
      shortString.encodeShortString('Ada'), '0x5', '0x1', '0x2', '0x98', '0x99',
      '0x1', '0x2a', '0x64', '0x456'
    ];
    event = mongoose.model('Starknet')({
      data,
      event: 'OffchainCrewmateGranted',
      logIndex: 1,
      name: 'OffchainCrewmateGranted',
      timestamp: 1695691834,
      transactionHash: '0x123456789',
      transactionIndex: 1
    });
    event.returnValues = Handler.transformEventData(event);

    await mongoose.model('CrewmatePurchase').create({
      externalRef: '0xabc',
      purchaser: event.returnValues.recipient,
      recipient: event.returnValues.recipient,
      status: 'grant_submitted',
      stripePriceId: 'price_1',
      stripeProductId: 'prod_crewmate'
    });
    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'CrewmatePurchase']);
  });

  it('should parse the complete event data layout', function () {
    expect(event.returnValues).to.deep.include({
      class: 3,
      collection: 4,
      composition: [152, 153],
      cosmetic: [11, 12, 13],
      impactful: [10],
      name: 'Ada',
      restrictedUntil: 100
    });
    expect(event.returnValues.crewmate).to.deep.equal({ label: 2, id: 153 });
    expect(event.returnValues.callerCrew).to.deep.equal({ label: 1, id: 42 });
  });

  it('should confirm the matching purchase and queue changed entities', async function () {
    await new Handler(event).processEvent();
    const purchase = await mongoose.model('CrewmatePurchase').findOne({ externalRef: '0xabc' }).lean();

    expect(purchase.status).to.equal('grant_confirmed');
    expect(purchase.grantedCrewmate.id).to.equal(153);
    expect(purchase.grantedCrew.id).to.equal(42);
    expect(ElasticSearchService.queueEntityForIndexing.callCount).to.equal(2);
  });
});
