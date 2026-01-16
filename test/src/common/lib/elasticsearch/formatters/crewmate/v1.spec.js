const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/crewmate');

describe('Crewmate formatter (v1)', function () {
  describe('formatter', function () {
    it('should format and return the crewmate document', async function () {
      const entity = Entity.Crewmate(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10002',
        _index: 'crewmate_v1',
        formatted: {
          id: 1,
          label: 2,
          uuid: '0x10002',
          Control: null,
          Crewmate: null,
          Name: null,
          Nft: null,
          meta: { crew: { name: null } }
        }
      });
    });
  });
});
