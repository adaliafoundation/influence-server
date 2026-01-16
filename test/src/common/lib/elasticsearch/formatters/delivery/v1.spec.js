const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/delivery');

describe('Delivery formatter (v1)', function () {
  describe('formatter', function () {
    it('should format and return the delivery document', async function () {
      const entity = Entity.Delivery(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10009',
        _index: 'delivery_v1',
        formatted: {
          id: 1,
          label: 9,
          uuid: '0x10009',
          Control: null,
          Delivery: null,
          PrivateSale: null
        }
      });
    });
  });
});
