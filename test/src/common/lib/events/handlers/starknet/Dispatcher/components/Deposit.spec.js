const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Deposit');

describe('ComponentUpdated: Deposit Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1', '0x10001',
          '0x1',
          '0x2',
          '0x3',
          '0x4',
          '0x64a59467',
          '0x6', '0x0'
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 1, id: 1 },
        status: 1,
        resource: 2,
        initialYield: 3,
        remainingYield: 4,
        finishTime: 1688573031,
        yieldEff: 1.3969838619232178e-9
      });
    });
  });
});
