const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewmatesArranged/v1');

describe('Disptcher::CrewmatesArranged (v1) Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'CrewmatesArrangedV1',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x5', '0x1', '0x2', '0x3', '0x4', '0x5',
        '0x5', '0x1', '0x4', '0x7', '0x8', '0x9',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        compositionOld: [1, 2, 3, 4, 5],
        compositionNew: [1, 4, 7, 8, 9],
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
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
