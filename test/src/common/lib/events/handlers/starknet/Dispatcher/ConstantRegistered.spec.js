const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/ConstantRegistered');

describe('Dispatcher::ConstantRegistered Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'ConstantRegistered',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x41535445524f49445f424153455f50524943455f455448',
        '0x6a94d74f430000'
      ],
      returnValues: {
        name: 'ASTEROID_BASE_PRICE_ETH',
        value: '0x6a94d74f430000'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections('Constant');
  });

  describe('processEvent', function () {
    it('should add the specified constant to the constants collection', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('Constant').findOne({ name: 'ASTEROID_BASE_PRICE_ETH' });
      expect(doc).to.be.an('object');
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
