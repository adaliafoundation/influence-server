const { expect } = require('chai');
const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const { ElasticSearchService, PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/agreements/Contract');

describe('ComponentUpdated: ContractAgreement Handler', function () {
  let event;
  const stubs = {
    updateLotLeaseStatus: null,
    queueEntityForIndexing: null,
    queueEntitiesForIndexing: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_ContractAgreement',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x1000000010004',
        '0x1',
        '0x10001',
        '0x123456789'
      ],
      returnValues: {
        entity: { id: 4294967297, label: 4 },
        permission: 1,
        permitted: { label: 1, id: 1 },
        address: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    stubs.queueEntitiesForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntitiesForIndexing')
      .resolves();
    stubs.updateLotLeaseStatus = this._sandbox.stub(PackedLotDataService, 'updateLotLeaseStatus').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['ContractAgreementComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the ContractAgreementComponent doc', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('ContractAgreementComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('should delete the ContractAgreementComponent doc, if address is 0', async function () {
      await (new Handler(event)).processEvent();
      event.data[4] = '0x0';
      event.returnValues.address = Address.toStandard(0, 'starknet');
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('ContractAgreementComponent').find().lean();
      expect(docs).to.have.lengthOf(0);
    });

    it('should queue the entity for indexing', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
    });

    it('should attempt to index related buildings and update the packed lot data', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.queueEntitiesForIndexing.calledOnce).to.equal(true);
      expect(stubs.updateLotLeaseStatus.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
