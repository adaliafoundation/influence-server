const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Crew/v0');

describe('ComponentUpdated: Crew Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10001',
          '0x1',
          '0x5', '0x1', '0x2', '0x3', '0x4', '0x5',
          '0x64a59467',
          '0x64a59476',
          '0x2',
          '0x1', '0x2',
          '0x4',
          '0x1'
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 1, id: 1 },
        delegatedTo: '0x0000000000000000000000000000000000000000000000000000000000000001',
        roster: [1, 2, 3, 4, 5],
        lastFed: 1688573031,
        readyAt: 1688573046,
        actionType: 2,
        actionTarget: { label: 1, id: 2 },
        actionRound: 4,
        actionWeight: 1
      });
    });
  });
});
