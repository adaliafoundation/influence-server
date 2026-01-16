const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/order');

describe('Order formatter (v1)', function () {
  afterEach(function () {
    return this.utils.resetCollections(['IndexItem', 'OrderComponent']);
  });

  describe('formatter', function () {
    it('should format and return the order document', async function () {
      const doc = await mongoose.model('OrderComponent').create({
        entity: Entity.Building(1),
        amount: 1,
        crew: Entity.Crew(1),
        initialAmount: 1,
        initialCaller: '0x1',
        makerFee: 1,
        orderType: 1,
        product: 1,
        price: 1,
        storage: Entity.Building(2),
        storageSlot: 1,
        status: 1,
        validTime: 1
      });

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: { _id: doc.id }, model: 'OrderComponent' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: doc.id.toString(),
        _index: 'order_v1',
        formatted: {
          entity: { id: 1, label: 5, uuid: '0x10005' },
          amount: 1,
          crew: { id: 1, label: 1, uuid: '0x10001' },
          initialAmount: 1,
          initialCaller: '0x0000000000000000000000000000000000000001',
          makerFee: 1,
          orderType: 1,
          product: 1,
          price: 1,
          storage: { id: 2, label: 5, uuid: '0x20005' },
          storageSlot: 1,
          status: 1,
          validTime: 1
        }
      });
    });
  });
});
