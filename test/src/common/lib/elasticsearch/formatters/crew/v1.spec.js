const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/crew');

describe('Crew formatter (v1)', function () {
  describe('formatter', function () {
    it('should format and return the crew document', async function () {
      const entity = Entity.Crew(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10001',
        _index: 'crew_v1',
        formatted: {
          id: 1,
          label: 1,
          uuid: '0x10001',
          Crew: null,
          Location: null,
          Inventories: [],
          Name: null,
          Nft: null,
          Ship: null,
          meta: {
            asteroid: { name: null },
            building: { name: null },
            crewmates: [],
            ship: { name: null }
          }
        }
      });
    });
  });
});
