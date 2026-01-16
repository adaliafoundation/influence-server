const { expect } = require('chai');
const mongoose = require('mongoose');
const {
  DeliveryFinished: Handler,
  DeliveryStarted } = require('@common/lib/events/handlers/starknet/Dispatcher');
const ActivityService = require('../../../../../../../../../../src/common/services/Activity');

describe('DeliveryFinished Handler', function () {
  let endEvent;
  let startEvent;

  beforeEach(function () {
    startEvent = mongoose.model('Starknet')({
      event: 'DeliveryStarted',
      name: 'DeliveryStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x1', '0x1', '0x1',
        '0x5', '0x2',
        '0x1',
        '0x9', '0x1',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        origin: { id: 1, label: 5 },
        originSlot: 1,
        products: [{ product: 1, amount: 1 }],
        dest: { id: 2, label: 5 },
        destSlot: 1,
        delivery: { id: 1, label: 9 },
        finishTime: 1,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    endEvent = mongoose.model('Starknet')({
      event: 'DeliveryFinished',
      logIndex: 2,
      timestamp: 1695691835,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x9', '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        delivery: { id: 1, label: 9 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(endEvent);
      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should resolve the correct Activity Item', async function () {
      const { doc } = await ActivityService.findOrCreateOne({
        addresses: [],
        entities: [],
        event: startEvent,
        hashKeys: DeliveryStarted.hashKeys,
        unresolvedFor: [startEvent.returnValues.callerCrew]
      });

      const handler = new Handler(endEvent);
      await handler.processEvent();
      const startActivityDoc = await mongoose.model('Activity').findById(doc._id);
      expect(startActivityDoc.unresolvedFor).to.equal(null);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(endEvent);
      expect(result).to.deep.equal(endEvent.returnValues);
    });
  });
});
