const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Station');

describe('ComponentUpdated: Station Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10005',
          '0x2',
          '0x2'
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 5, id: 1 },
        stationType: 2,
        population: 2
      });
    });
  });
});
