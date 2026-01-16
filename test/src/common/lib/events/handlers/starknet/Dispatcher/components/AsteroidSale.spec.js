const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/AsteroidSale');

describe('Dispatcher::ComponentUpdated_AsteroidSale Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_AsteroidSale',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x6a0',
        '0x64'
      ],
      returnValues: {
        period: 1696,
        volume: 100
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['AsteroidSale', 'IndexItem']);
  });

  describe('processEvent', function () {
    it('should create/update the correct AsteroidSale document', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('AsteroidSale').findOne({ period: event.returnValues.period });
      expect(doc.period).to.equal(event.returnValues.period);
      expect(doc.volume).to.equal(event.returnValues.volume);
      expect(doc.event.id.toString()).to.equal(event._id.toString());
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
