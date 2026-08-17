const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/StarterPackBuildingFunding');

describe('ComponentUpdated: StarterPackBuildingFunding Handler', function () {
  let event;
  let queueEntityForIndexingStub;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_StarterPackBuildingFunding',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: ['0x1', '0x10005', '0x1', '0x1', '0x64'],
      returnValues: {
        entity: { id: 1, label: 5, uuid: '0x10005' },
        crew: { label: 1, id: 1 },
        restrictedUntil: 100
      }
    });

    queueEntityForIndexingStub = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['StarterPackBuildingFundingComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the StarterPackBuildingFundingComponent doc', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('StarterPackBuildingFundingComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
      expect(docs[0].restrictedUntil).to.equal(100);
    });

    it('should queue the building for indexing', async function () {
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
