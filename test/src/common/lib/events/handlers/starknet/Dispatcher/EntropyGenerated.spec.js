const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/EntropyGenerated');

describe('Dispatcher::EntropyGenerated Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'EntropyGenerated',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x41535445524f49445f424153455f50524943455f455448',
        '10'
      ],
      returnValues: {
        entropy: '0x41535445524f49445f424153455f50524943455f455448',
        round: 10
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections('Entropy');
  });

  describe('processEvent', function () {
    it('should update/create a new entropy document', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('Entropy').findOne({ round: 10 });
      expect(doc).to.be.an('object');
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
