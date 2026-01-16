const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const { ElasticSearchService, NftComponentService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Celestial');

describe('ComponentUpdated: Celestial Handler', function () {
  let event;
  const stubs = {
    OpenSea: null,
    Unframed: null,
    flagForCardUpdate: null,
    queueEntityForIndexing: null
  };

  before(function () {
    stubs.OpenSea = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
    stubs.Unframed = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
    stubs.flagForCardUpdate = this._sandbox.stub(NftComponentService, 'flagForCardUpdate').resolves();
    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_Celestial',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x10001',
        '0x2',
        '0x111111111', '0x0',
        '0x222222222', '0x0',
        '0x4',
        '0x5',
        '0x6',
        '0x7',
        '0x8'
      ],
      returnValues: {
        entity: { label: 1, id: 1 },
        celestialType: 2,
        mass: 1.0666666666511446,
        radius: 2.1333333333022892,
        purchaseOrder: 4,
        scanStatus: 5,
        scanFinishTime: 6,
        bonuses: 7,
        abundances: '0x8'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['CelestialComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the CelestialComponent', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('CelestialComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('should flag the NftComponent for card update', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.flagForCardUpdate.calledOnce).to.equal(true);
    });

    it('queue the entity for indexing', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
    });

    it('should attempt to update the marketplace(s)', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.OpenSea.calledOnce).to.equal(true);
      expect(stubs.Unframed.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
