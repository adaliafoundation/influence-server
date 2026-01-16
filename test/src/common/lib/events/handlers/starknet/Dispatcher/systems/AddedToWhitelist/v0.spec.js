const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/AddedToWhitelist/v0');

describe('AddedToWhitelist Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'AddedToWhitelist',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x1',
        '0x1',
        '0x1', '0x2',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        entity: { label: 1, id: 1 },
        permission: 1,
        target: { id: 2, label: 1 },
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
