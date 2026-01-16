const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidInitialized');
const { ComponentService } = require('@common/services');

describe('AsteroidInitialized Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      blockNumber: 1,
      blockHash: '0x123456789',
      event: 'AsteroidInitialized',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: ['0x3', '0x1'],
      returnValues: { asteroid: { id: 1, label: 3 } }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should clear the corresponding AsteroidProof documnet', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      const doc = await ComponentService.findOneByEntity(
        'AsteroidProof',
        Entity.Asteroid(event.returnValues.asteroid.id)
      );
      expect(doc).to.be.an('object');
      expect(doc.used).to.be.eql(true);
      expect(doc.proof).to.be.eql([]);
    });

    it('should update the marketplace(s)', async function () {
      const openSeaStub = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
      const unframedStub = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
      await (new Handler(event)).processEvent();

      expect(openSeaStub.calledOnce).to.equal(true);
      expect(unframedStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
