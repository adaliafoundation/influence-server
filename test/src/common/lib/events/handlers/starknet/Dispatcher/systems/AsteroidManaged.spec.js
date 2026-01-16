const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidManaged');

describe('AsteroidManaged Handler', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const event = mongoose.model('Starknet')({
        event: 'AsteroidManaged',
        logIndex: 1,
        timestamp: 1695691834,
        transactionIndex: 1,
        transactionHash: '0x123456789',
        returnValues: {
          asteroid: { id: 1, label: 3 },
          callerCrew: { label: 1, id: 1 },
          caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
        }
      });
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x3', '0x1',
          '0x1', '0x1',
          '0x123456789'
        ]
      });

      expect(result).to.deep.equal({
        asteroid: { id: 1, label: 3 },
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      });
    });
  });
});
