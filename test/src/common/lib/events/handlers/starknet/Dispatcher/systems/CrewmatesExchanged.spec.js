const { expect } = require('chai');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewmatesExchanged');

describe('CrewmatesExchanged Handler', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('transformEventData', function () {
    it('should transform the data correctly (scenario 1)', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1', '0x01', // crew1 Entity
          '0x2', '0x1', '0x2', // crew1CompositionOld
          '0x1', '0x1', // crew1CompositionNew
          '0x1', '0x02', // crew2 Entity
          '0x0', // crew2CompositionOld
          '0x1', '0x2', // crew2CompositionNew
          '0x123456789' // caller
        ]
      });

      expect(result).to.deep.equal({
        crew1: { label: 1, id: 1 },
        crew1CompositionOld: [{ id: 1, label: 2 }, { id: 2, label: 2 }],
        crew1CompositionNew: [{ id: 1, label: 2 }],
        crew2: { label: 1, id: 2 },
        crew2CompositionOld: [],
        crew2CompositionNew: [{ id: 2, label: 2 }],
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      });
    });

    it('should transform the data correctly (scenario 2)', function () {
      const result = Handler.transformEventData({
        data: [
          '0x1', '0x01', // crew1 Entity
          '0x3', '0x1', '0x2', '0x3', // crew1CompositionOld
          '0x2', '0x1', '0x2', // crew1CompositionNew
          '0x1', '0x02', // crew2 Entity
          '0x3', '0x4', '0x5', '0x6', // crew2CompositionOld
          '0x4', '0x4', '0x5', '0x6', '0x3', // crew2CompositionNew
          '0x123456789' // caller
        ]
      });

      expect(result).to.deep.equal({
        crew1: { label: 1, id: 1 },
        crew1CompositionOld: [{ id: 1, label: 2 }, { id: 2, label: 2 }, { id: 3, label: 2 }],
        crew1CompositionNew: [{ id: 1, label: 2 }, { id: 2, label: 2 }],
        crew2: { label: 1, id: 2 },
        crew2CompositionOld: [{ id: 4, label: 2 }, { id: 5, label: 2 }, { id: 6, label: 2 }],
        crew2CompositionNew: [
          { id: 4, label: 2 },
          { id: 5, label: 2 },
          { id: 6, label: 2 },
          { id: 3, label: 2 }
        ],
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      });
    });
  });
});
