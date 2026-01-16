const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Extractor');

describe('ComponentUpdated: Extractor Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1',
          '0x10001', // entity
          '0x1', // slot
          '0x1', // exractorType
          '0x2', // status
          '0x100', // outputProduct
          '0x10002', // yield
          '0x5', '0x4', // destination
          '0x1', // destinationSlot
          '0x64a59467' // finishTime
        ]
      });

      expect(result).to.deep.equal({
        entity: { label: 1, id: 1 },
        slot: 1,
        extractorType: 1,
        status: 2,
        outputProduct: 256,
        yield: 65538,
        destination: { label: 5, id: 4 },
        destinationSlot: 1,
        finishTime: 1688573031
      });
    });
  });
});
