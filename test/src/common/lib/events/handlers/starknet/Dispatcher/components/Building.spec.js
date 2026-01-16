const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Building');

describe('ComponentUpdated: Building Handler', function () {
  let event;
  const stubs = {
    queueEntityForIndexing: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_Building',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x10005',
        '0x2',
        '0x1',
        '0x64a59467',
        '0x64a59467'
      ],
      returnValues: {
        entity: { label: 5, id: 1 },
        status: 2,
        buildingType: 1,
        plannedAt: 1688573031,
        finishTime: 1688573031
      }
    });

    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['BuildingComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the BuildingComponent', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('BuildingComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('queue the entity for indexing', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
