const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Order');

describe('ComponentUpdated: Order Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x7', // path key len
          '0x10001', // crew
          '0x10005', // entity/exchange
          '0x2', // Order Type
          '0x3', // Product
          '0x5', // Price
          '0x20005', // storage
          '0x1', // stoprage slot
          '0x1', // status
          '0x4', // amount
          '0x6', // valid Time
          '0x7' // maker fee
        ]
      });

      expect(result).to.deep.equal({
        crew: { id: 1, label: 1 },
        entity: { id: 1, label: 5 },
        orderType: 2,
        product: 3,
        price: 5,
        storage: { id: 2, label: 5 },
        storageSlot: 1,
        status: 1,
        amount: 4,
        validTime: 6,
        makerFee: 7
      });
    });
  });
});
