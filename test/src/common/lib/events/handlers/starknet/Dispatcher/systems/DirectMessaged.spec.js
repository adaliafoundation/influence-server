const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/DirectMessageSent');

describe('DirectMessageSent Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'DirectMessageSent',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x123456788',
        '0x1', '0x5465737420636f6e74656e742068617368',
        '0x123456789'
      ],
      returnValues: {
        recipient: '0x0000000000000000000000000000000000000000000000000000000123456788',
        contentHash: 'Test content hash',
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
