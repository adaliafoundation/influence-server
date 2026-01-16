const { expect } = require('chai');
const mongoose = require('mongoose');
const { ReferralService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidPurchased');

describe('AsteroidPurchased Handler', function () {
  let event;
  const stubs = {
    createReferralForBuyer: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'AsteroidPurchased',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x3', '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        asteroid: { id: 1, label: 3 },
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    stubs.createReferralForBuyer = this._sandbox.stub(ReferralService, 'createReferralForBuyer').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Constant', 'Entity', 'InternalSaleComponent', 'Referral']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should call ReferralService.createReferralForBuyer', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.createReferralForBuyer.calledOnce).to.equal(true);
    });

    it('should create an internal sale component', async function () {
      await mongoose.model('Constant').create([
        { name: 'ASTEROID_PURCHASE_BASE_PRICE', value: 500 },
        { name: 'ASTEROID_PURCHASE_LOT_PRICE', value: 100 }
      ]);
      await (new Handler(event)).processEvent();
      const componentDocs = await mongoose.model('InternalSaleComponent').find({});
      expect(componentDocs).to.have.lengthOf(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
