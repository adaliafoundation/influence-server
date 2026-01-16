const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Inventory');

describe('ComponentUpdated: Inventory Handler', function () {
  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x2',
          '0x30005',
          '0x1',
          '0x2',
          '0x1',
          '0x5552f4e0',
          '0x53a03fb8',
          '0x61158400',
          '0x5f5e2f40',
          '0x9',
          '0x2c',
          '0x61a80',
          '0x45',
          '0xdbba0',
          '0x46',
          '0x186a0',
          '0xec',
          '0x3',
          '0x7d',
          '0xbb8',
          '0xed',
          '0x2',
          '0xf0',
          '0x1',
          '0xee',
          '0x3',
          '0xf3',
          '0x2'
        ]
      });

      expect(result).to.deep.equal({
        entity: { id: 3, label: 5 },
        slot: 1,
        inventoryType: 2,
        status: 1,
        mass: 1431500000,
        volume: 1403011000,
        reservedMass: 1628800000,
        reservedVolume: 1600008000,
        contents: [
          { product: 44, amount: 400000 },
          { product: 69, amount: 900000 },
          { product: 70, amount: 100000 },
          { product: 236, amount: 3 },
          { product: 125, amount: 3000 },
          { product: 237, amount: 2 },
          { product: 240, amount: 1 },
          { product: 238, amount: 3 },
          { product: 243, amount: 2 }
        ]
      });
    });
  });
});
