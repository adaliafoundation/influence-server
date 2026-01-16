const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/ethereum/AsteroidScans/AsteroidScanned');

describe('AsteroidScans::AsteroidScanned', function () {
  let event;

  before(function () {
    event = mongoose.model('Ethereum')({
      transactionHash: '0x123',
      blockNumber: 123,
      logIndex: 0,
      event: 'AsteroidScanned',
      timestamp: 1,
      transactionIndex: 1,
      returnValues: {
        asteroidId: '1',
        bonuses: '1'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'Event', 'CelestialComponent', 'IndexItem']);
  });

  describe('processEvent', function () {
    let handler;

    beforeEach(function () {
      handler = new Handler(event);
    });

    it('should create/update a CelestialComponent document', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('CelestialComponent').findOne({ entity: { id: 1, label: 3 } });
      expect(doc.bonuses).to.equal(1);
      expect(doc.scanStatus).to.equal(2);
    });

    it('should create an Activity document', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('Activity').findOne({ entities: [{ id: 1, label: 3 }] });
      expect(doc.event.event).to.equal('AsteroidScanned');
    });

    it('should flag the entity for indexing', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10003' }
      });
      expect(doc).to.be.an('object');
    });
  });
});
