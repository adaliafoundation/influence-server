const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const formatter = require('@common/lib/elasticsearch/formatters/deposit/v1');

describe('Deposit formatter (v1)', function () {
  afterEach(function () {
    return this.utils.resetCollections(['ContractAgreementComponent']);
  });

  describe('formatter', function () {
    it('should format and return the asterid document', async function () {
      const entity = Entity.Deposit(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10007',
        _index: 'deposit_v1',
        formatted: {
          id: 1,
          label: 7,
          uuid: '0x10007',
          Control: null,
          Deposit: null,
          Location: null,
          PrivateSale: null,
          meta: {
            asteroid: {
              name: null
            },
            crew: {
              name: null
            }
          }
        }
      });

      expect(result._id).to.equal('0x10007');
      expect(result._index).to.equal('deposit_v1');
    });
  });
});
