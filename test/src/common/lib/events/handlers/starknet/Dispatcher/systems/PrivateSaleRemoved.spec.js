const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/PrivateSaleRemoved');

describe('PrivateSaleRemoved Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'PrivateSaleRemoved',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x2',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        entity: { id: 2, label: 1 },
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
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(handler.messages._messages).to.have.lengthOf(1);
      expect(handler.messages._messages).to.deep.equal([{ to: 'Crew::1' }]);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
