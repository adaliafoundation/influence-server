const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/StarterPack');

describe('ComponentUpdated: StarterPack Handler', function () {
  let event;
  let queueEntityForIndexingStub;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_StarterPack',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x10001',
        '0x1',
        '0x64',
        '0x1',
        '0x0',
        '0x2',
        '0x1',
        '0x2',
        '0x2',
        '0x1',
        '0x3',
        '0x4',
        '0x5'
      ],
      returnValues: {
        entity: { id: 1, label: 1, uuid: '0x10001' },
        productId: 1,
        restrictedUntil: 100,
        valid: true,
        invalidatedAt: 0,
        buildingAllowances: [
          { buildingType: 1, count: 2 },
          { buildingType: 2, count: 1 }
        ],
        lotAllowance: 3,
        foodReloadAllowance: 4,
        coreSampleAllowance: 5
      }
    });

    queueEntityForIndexingStub = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['StarterPackComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the StarterPackComponent doc', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('StarterPackComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
      expect(docs[0].productId).to.equal(1);
      expect(docs[0].buildingAllowances.map(({ buildingType, count }) => ({ buildingType, count }))).to.deep.equal([
        { buildingType: 1, count: 2 },
        { buildingType: 2, count: 1 }
      ]);
    });

    it('should queue the crew for indexing', async function () {
      await (new Handler(event)).processEvent();
      expect(queueEntityForIndexingStub.calledOnceWith(event.returnValues.entity)).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
