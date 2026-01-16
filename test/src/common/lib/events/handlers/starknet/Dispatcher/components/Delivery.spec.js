const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Delivery');

describe('ComponentUpdated: Delivery Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10009',
          '0x1',
          '0x5',
          '0x2',
          '0x2',
          '0x5',
          '0x3',
          '0x1',
          '0x654e941f',
          '0x1',
          '0x2c',
          '0x61a80'
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 9, id: 1 },
        status: 1,
        origin: { label: 5, id: 2 },
        originSlot: 2,
        dest: { label: 5, id: 3 },
        destSlot: 1,
        finishTime: 1699648543,
        contents: [{ product: 44, amount: 400000 }]
      });
    });
  });
});
