const { expect } = require('chai');
const Entity = require('@common/lib/Entity');
const Indexer = require('@common/lib/elasticsearch/Indexer');

describe('ElasticSearch Indexer', function () {
  describe('getFormatters', function () {
    it('should return the correct formatter for an OrderComponent IndexItem', async function () {
      const result = (new Indexer()).getFormatters({ model: 'OrderComponent', identifier: { _id: 1 } });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Crew Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({ model: 'Entity', identifier: { id: 1, label: Entity.IDS.CREW } });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Crewmate Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.CREWMATE }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Asteroid Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.ASTEROID }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Building Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.BUILDING }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Ship Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.SHIP }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Deposit Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.DEPOSIT }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });

    it('should return the correct formatter for a Delivery Entity IndexItem', async function () {
      const result = (new Indexer()).getFormatters({
        model: 'Entity',
        identifier: { id: 1, label: Entity.IDS.DELIVERY }
      });
      expect(result).to.be.a('object');
      expect(result.v1).to.be.a('function');
    });
  });
});
