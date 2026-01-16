const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const formatter = require('@common/lib/elasticsearch/formatters/ship/v1');

describe('Ship formatter (v1)', function () {
  afterEach(function () {
    return this.utils.resetCollections(['ContractAgreementComponent', 'ControlComponent', 'Entity',
      'LocationComponent', 'PrepaidAgreementComponent', 'WhitelistAgreementComponent']);
  });

  describe('formatter', function () {
    it('should format and return the asterid document', async function () {
      const entity = Entity.Ship(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });

      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10006',
        _index: 'ship_v1',
        formatted: {
          id: 1,
          label: 6,
          uuid: '0x10006',
          ContractAgreements: [],
          ContractPolicies: [],
          Control: null,
          Inventories: [],
          Location: null,
          Name: null,
          Nft: null,
          PrepaidAgreements: [],
          PrepaidPolicies: [],
          PublicPolicies: [],
          Ship: null,
          Station: null,
          WhitelistAgreements: [],
          WhitelistAccountAgreements: [],
          meta: {
            asteroid: { name: null },
            building: { name: null },
            crew: { name: null }
          }
        }
      });

      expect(result._id).to.equal('0x10006');
      expect(result._index).to.equal('ship_v1');
    });

    it('should filter out upcoming or expired prepaid agreements', async function () {
      await mongoose.model('PrepaidAgreementComponent').create([
        {
          entity: Entity.Ship(1),
          permission: 1,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(1, 'days').unix(),
          endTime: moment().add(10, 'days').unix()
        },
        { // expired 7 days
          entity: Entity.Ship(1),
          permission: 2,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(2, 'days').unix(),
          endTime: moment().subtract(7, 'days').unix()
        },
        { // expired over 7 days
          entity: Entity.Ship(1),
          permission: 3,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(2, 'days').unix(),
          endTime: moment().subtract(8, 'days').unix()
        }
      ]);
      const indexItemdoc = mongoose.model('IndexItem')({ identifier: Entity.Ship(1), model: 'Entity' });
      const result = await formatter(indexItemdoc.toJSON());
      expect(result.formatted.PrepaidAgreements).to.have.length(2);
    });
  });
});
