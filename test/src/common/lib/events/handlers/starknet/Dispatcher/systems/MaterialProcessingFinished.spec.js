const { expect } = require('chai');
const mongoose = require('mongoose');
const { ActivityService } = require('@common/services');
const {
  MaterialProcessingFinished: Handler,
  MaterialProcessingStarted } = require('@common/lib/events/handlers/starknet/Dispatcher');

describe('MaterialProcessingFinished Handler', function () {
  let endEvent;
  let startEvent;

  beforeEach(function () {
    startEvent = mongoose.model('Starknet')({
      event: 'MaterialProcessingStarted',
      name: 'MaterialProcessingStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        processor: { id: 1, label: 5 },
        processorSlot: 1,
        process: 1,
        inputs: [{ product: 1, amount: 1 }],
        outputs: [{ product: 2, amount: 2 }],
        destination: { id: 2, label: 5 },
        destinationSlot: 1,
        finishTime: 1695691834,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    endEvent = mongoose.model('Starknet')({
      event: 'MaterialProcessingFinished',
      logIndex: 2,
      timestamp: 1695691835,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        processor: { id: 1, label: 5 },
        processorSlot: 1,
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
        addresses: [startEvent.returnValues.caller],
        entities: [
          startEvent.returnValues.processor,
          startEvent.returnValues.destination,
          startEvent.returnValues.callerCrew],
        event: startEvent,
        hashKeys: MaterialProcessingStarted.hashKeys,
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
      const result = Handler.transformEventData({
        data: [
          '0x5', '0x1',
          '0x1',
          '0x1', '0x1',
          '0x123456789'
        ]
      });

      expect(result).to.deep.equal(endEvent.returnValues);
    });
  });
});
