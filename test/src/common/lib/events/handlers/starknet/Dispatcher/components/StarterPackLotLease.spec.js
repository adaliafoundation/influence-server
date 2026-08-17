const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/StarterPackLotLease');

describe('ComponentUpdated: StarterPackLotLease Handler', function () {
  let event;
  let queueEntityForIndexingStub;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_StarterPackLotLease',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: ['0x3', '0x1000000010004', '0x1', '0x10001', '0x1', '0x1'],
      returnValues: {
        entity: { id: 4294967297, label: 4, uuid: '0x1000000010004' },
        permission: 1,
        permitted: { id: 1, label: 1, uuid: '0x10001' },
        crew: { label: 1, id: 1 }
      }
    });

    queueEntityForIndexingStub = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['StarterPackLotLeaseComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the StarterPackLotLeaseComponent doc', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('StarterPackLotLeaseComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
      expect(docs[0].permission).to.equal(1);
    });

    it('should queue the lot for indexing', async function () {
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
