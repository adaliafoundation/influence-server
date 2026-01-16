const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const { v1: formatter } = require('@common/lib/elasticsearch/formatters/building');

describe('Building formatter (v1)', function () {
  afterEach(function () {
    return this.utils.resetCollections(['ContractAgreementComponent', 'ControlComponent', 'Entity',
      'LocationComponent', 'PrepaidAgreementComponent', 'WhitelistAgreementComponent']);
  });

  describe('formatter', function () {
    it('should format and return the building document', async function () {
      const entity = Entity.Building(1);

      const indexItemdoc = mongoose.model('IndexItem')({ identifier: entity, model: 'Entity' });
      const result = await formatter(indexItemdoc);
      expect(result).to.deep.equal({
        _id: '0x10005',
        _index: 'building_v1',
        formatted: {
          id: 1,
          label: 5,
          uuid: '0x10005',
          Building: null,
          ContractAgreements: [],
          ContractPolicies: [],
          Control: null,
          Dock: null,
          DryDocks: [],
          Exchange: null,
          Extractors: [],
          Inventories: [],
          Location: null,
          Name: null,
          PrepaidAgreements: [],
          PrepaidPolicies: [],
          Processors: [],
          PublicPolicies: [],
          Station: null,
          WhitelistAgreements: [],
          WhitelistAccountAgreements: [],
          meta: {
            asteroid: { name: null },
            crew: { name: null },
            lotOccupation: null,
            lotUser: null
          }
        }
      });
    });

    it('should filter out upcoming or expired prepaid agreements', async function () {
      await mongoose.model('PrepaidAgreementComponent').create([
        {
          entity: Entity.Building(1),
          permission: 1,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(1, 'days').unix(),
          endTime: moment().add(10, 'days').unix()
        },
        {
          entity: Entity.Building(1),
          permission: 2,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(2, 'days').unix(),
          endTime: moment().subtract(6, 'days').unix()
        },
        {
          entity: Entity.Building(1),
          permission: 3,
          permitted: Entity.Crew(1),
          startTime: moment().subtract(2, 'days').unix(),
          endTime: moment().subtract(8, 'days').unix()
        }
      ]);
      const indexItemdoc = mongoose.model('IndexItem')({ identifier: Entity.Building(1), model: 'Entity' });
      const result = await formatter(indexItemdoc.toJSON());
      expect(result.formatted.PrepaidAgreements).to.have.length(2);
    });
  });
});
