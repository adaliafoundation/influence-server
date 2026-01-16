const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/DryDock');

describe('ComponentUpdated: DryDock Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10001',
          '0x1',
          '0x1',
          '0x1',
          '0x1', '0x2',
          '0x1'
        ]
      });

      expect(result).to.deep.equal({
        entity: { id: 1, label: 1 },
        slot: 1,
        dryDockType: 1,
        status: 1,
        outputShip: { label: 1, id: 2 },
        finishTime: 1
      });
    });
  });
});
