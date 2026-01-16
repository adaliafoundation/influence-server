const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/policies/Prepaid');

describe('ComponentUpdated: PrepaidPolicy Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10003',
          '0x1',
          '0x1',
          '0x1e',
          '0xa'
        ]
      });

      expect(result).to.deep.equal({
        entity: { id: 1, label: 3 },
        permission: 1,
        rate: 1,
        initialTerm: 30,
        noticePeriod: 10
      });
    });
  });
});
