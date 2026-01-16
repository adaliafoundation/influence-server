const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Processor/v0');

describe('ComponentUpdated: Processor Handler (v0)', function () {
  let event;
  const stubs = {
    queueEntityForIndexing: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_Processor',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x2',
        '0x10005',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1', '0x0',
        '0x5', '0x2',
        '0x1',
        '0x64a59467'
      ],
      returnValues: {
        entity: { label: 5, id: 1 },
        slot: 1,
        processorType: 1,
        status: 1,
        runningProcess: 1,
        outputProduct: 1,
        recipes: 2.3283064365386963e-10,
        destination: { label: 5, id: 2 },
        destinationSlot: 1,
        finishTime: 1688573031
      }
    });

    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['ProcessorComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the ProcessorComponent', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('ProcessorComponent').find().lean();
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
