const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/OffchainStarterPackGranted');

describe('OffchainStarterPackGranted Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'OffchainStarterPackGranted',
      name: 'OffchainStarterPackGranted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: ['0xabc', '0x1', '0x123', '0x1', '0x5', '0x2', '0xa', '0xb', '0x64', '0x2', '0x1', '0x5', '0x456'],
      returnValues: {
        externalRef: '0xabc',
        productId: 1,
        recipient: '0x0000000000000000000000000000000000000000000000000000000000000123',
        crew: { label: 1, id: 5 },
        composition: [10, 11],
        restrictedUntil: 100,
        lotAllowance: 2,
        foodReloadAllowance: 1,
        coreSampleAllowance: 5,
        caller: '0x0000000000000000000000000000000000000000000000000000000000000456'
      }
    });

    await mongoose.model('StarterPackPurchase').create({
      externalRef: '0xabc',
      grantRequest: {
        recipient: event.returnValues.recipient,
        restrictedUntil: 100,
        station: { label: 5, id: 1 }
      },
      productId: 1,
      purchaser: event.returnValues.recipient,
      status: 'submitted',
      stripePriceId: 'price_123',
      stripeProductId: 'prod_123'
    });

    this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    this._sandbox.stub(ElasticSearchService, 'queueEntitiesForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity',
      'StarterPackCrewmateComponent',
      'StarterPackPurchase'
    ]);
  });

  describe('processEvent', function () {
    it('should derive starter crewmate components and mark the purchase granted', async function () {
      await (new Handler(event)).processEvent();

      const crewmateDocs = await mongoose.model('StarterPackCrewmateComponent').find().lean();
      const purchaseDoc = await mongoose.model('StarterPackPurchase').findOne({ externalRef: '0xabc' }).lean();

      expect(crewmateDocs).to.have.lengthOf(2);
      expect(crewmateDocs.map((doc) => doc.entity.id)).to.have.members([10, 11]);
      expect(purchaseDoc.status).to.equal('granted');
      expect(purchaseDoc.grantedCrew.id).to.equal(5);
    });

    it('should create an Activity Item correctly', async function () {
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
