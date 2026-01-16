const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/TestnetSwayClaimed');

describe('TestnetSwayClaimed Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'TestnetSwayClaimed',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0xf07882f780',
        '0x0',
        '0x76abe1b34dd6034718c2c99c96ecae3f8d76e844f50044b264d3a5fc9771081'
      ],
      returnValues: {
        amount: 1032814000000,
        caller: '0x076abe1b34dd6034718c2c99c96ecae3f8d76e844f50044b264d3a5fc9771081'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['SwayClaim']);
  });

  describe('processEvent', function () {
    it('should mark the corresponding swayclaim doc as claimed', async function () {
      await mongoose.model('SwayClaim').create({
        address: '0x76abe1b34dd6034718c2c99c96ecae3f8d76e844f50044b264d3a5fc9771081',
        phase: 'Testnet 2',
        amount: 1032814000000
      });
      const handler = new Handler(event);
      await handler.processEvent();
      const results = await mongoose.model('SwayClaim').find({
        address: '0x76abe1b34dd6034718c2c99c96ecae3f8d76e844f50044b264d3a5fc9771081'
      });
      expect(results.length).to.eql(1);
      expect(results[0].claimed).to.eql(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
