const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Exchange');

describe('ComponentUpdated: Exchange Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10001', // entity
          '0x1', // exchangeType
          '0x2', // makerFee
          '0x3', // takerFee
          '0x4', // orders
          '0x5', // allowedProducts length
          '0x1', '0x2', '0x3', '0x4', '0x5' // allowedProducts
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 1, id: 1 },
        exchangeType: 1,
        makerFee: 2,
        takerFee: 3,
        orders: 4,
        allowedProducts: [1, 2, 3, 4, 5]
      });
    });
  });
});
