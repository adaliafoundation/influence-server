const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService, NftComponentService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Orbit');

describe('ComponentUpdated: Orbit Handler', function () {
  let event;
  const stubs = {
    flagForCardUpdate: null,
    queueEntityForIndexing: null
  };

  before(function () {
    stubs.flagForCardUpdate = this._sandbox.stub(NftComponentService, 'flagForCardUpdate').resolves();
    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_Orbit',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x10001',
        '0x1', '0x0',
        '0x1', '0x0',
        '0x1', '0x0',
        '0x1', '0x0',
        '0x1', '0x0',
        '0x1', '0x0'
      ],
      returnValues: {
        entity: { label: 1, id: 1 },
        a: 5.421010862427522e-20,
        ecc: 5.421010862427522e-20,
        inc: 5.421010862427522e-20,
        raan: 5.421010862427522e-20,
        argp: 5.421010862427522e-20,
        m: 5.421010862427522e-20
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['OrbitComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the OrbitComponent', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('OrbitComponent').find().lean();
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
