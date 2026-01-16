const { expect } = require('chai');
const mongoose = require('mongoose');
const { BuyOrderCancelled: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('BuyOrderCancelled Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x1', '0x3a5',
        '0x5', '0x38',
        '0x1',
        '0x989680',
        '0xbb8',
        '0x5', '0x1d1',
        '0x2',
        '0x1', '0x3a5',
        '0x5827823835743b4841d47591a29924529a6d9b3ac9ea2435b9b328c1e0996ac'
      ],
      event: 'BuyOrderCancelled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        buyerCrew: { label: 1, id: 933 },
        exchange: { label: 5, id: 56 },
        product: 1,
        amount: 10000000,
        price: 3000,
        storage: { label: 5, id: 465 },
        storageSlot: 2,
        callerCrew: { label: 1, id: 933 },
        caller: '0x05827823835743b4841d47591a29924529a6d9b3ac9ea2435b9b328c1e0996ac'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
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
