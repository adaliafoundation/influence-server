const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/lot');

describe('Lot formatter (v1)', function () {
  describe('formatter', function () {
    it('should format and return the lot document', async function () {
      const entity = Entity.lotFromIndex(1, 1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x1000000010004',
        _index: 'lot_v1',
        formatted: {
          id: 4294967297,
          label: 4,
          uuid: '0x1000000010004',
          ContractAgreements: [],
          PrepaidAgreements: [],
          WhitelistAgreements: [],
          WhitelistAccountAgreements: [],
          Location: {
            location: { id: 1, label: 3, uuid: '0x10003' },
            locations: [{ id: 1, label: 3, uuid: '0x10003' }]
          },
          meta: {}
        }
      });
    });
  });
});
