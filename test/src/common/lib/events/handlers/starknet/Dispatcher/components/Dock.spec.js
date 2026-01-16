const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Dock');

describe('ComponentUpdated: Dock Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1', '0x10001',
          '0x1',
          '0x2'
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 1, id: 1 },
        dockType: 1,
        dockedShips: 2
      });
    });
  });
});
