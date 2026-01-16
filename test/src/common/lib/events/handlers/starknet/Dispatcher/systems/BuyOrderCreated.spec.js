const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { OrderComponentService } = require('@common/services');
const { BuyOrderCreated: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('BuyOrderCreated Handler', function () {
  let event;
  const stubs = {
    updateInitialCaller: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x5', '0x1',
        '0x1',
        '0x2',
        '0x3',
        '0x5', '0x2',
        '0x1',
        '0x2',
        '0x3',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'BuyOrderCreated',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        exchange: { label: 5, id: 1 },
        product: 1,
        amount: 2,
        price: 3,
        storage: { label: 5, id: 2 },
        storageSlot: 1,
        validTime: 2,
        makerFee: 3,
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    stubs.updateInitialCaller = sinon.stub(OrderComponentService, 'updateInitialCaller').resolves();
  });

  afterEach(function () {
    stubs.updateInitialCaller.restore();
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should attempt to update the initialCaller for the order component', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.updateInitialCaller.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
