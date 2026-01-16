const { expect } = require('chai');
const mongoose = require('mongoose');
const { BuyOrderFilled: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('BuyOrderFilled Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x1', '0x2',
        '0x5', '0x1',
        '0x1',
        '0x2',
        '0x3',
        '0x5', '0x2',
        '0x1',
        '0x5', '0x3',
        '0x2',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'BuyOrderFilled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        buyerCrew: { label: 1, id: 2 },
        exchange: { label: 5, id: 1 },
        product: 1,
        amount: 2,
        price: 3,
        storage: { label: 5, id: 2 },
        storageSlot: 1,
        origin: { label: 5, id: 3 },
        originSlot: 2,
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
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
