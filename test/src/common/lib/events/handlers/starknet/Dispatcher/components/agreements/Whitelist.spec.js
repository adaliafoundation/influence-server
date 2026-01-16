const { expect } = require('chai');
const mongoose = require('mongoose');
const { ComponentService, ElasticSearchService, PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/agreements/Whitelist');

describe('ComponentUpdated: WhitelistAgreement Handler', function () {
  let whitelistEvent;
  let whitelistAccountEvent;
  const stubs = {
    queueEntityForIndexing: null,
    queueEntitiesForIndexing: null,
    updateLotLeaseStatus: null,
    updateOrCreateFromEvent: null,
    deleteOne: null
  };

  beforeEach(function () {
    whitelistEvent = mongoose.model('Starknet')({
      event: 'ComponentUpdated_WhitelistAgreement',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x3',
        '0x10004',
        '0x1',
        '0x10001',
        '0x1'
      ],
      returnValues: {
        entity: { label: 4, id: 1 },
        permission: 1,
        permitted: { label: 1, id: 1 },
        whitelisted: true
      }
    });

    whitelistAccountEvent = mongoose.model('Starknet')({
      event: 'ComponentUpdated_WhitelistAgreement',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x3',
        '0x10004',
        '0x1',
        '0x041a3078c15fed9978b0e5bc37119e1cafc0ad659aebdc90f5f3fc8bd446f674',
        '0x1'
      ],
      returnValues: {
        entity: { label: 4, id: 1 },
        permission: 1,
        permitted: '0x041a3078c15fed9978b0e5bc37119e1cafc0ad659aebdc90f5f3fc8bd446f674',
        whitelisted: true
      }
    });

    stubs.deleteOne = this._sandbox.stub(ComponentService, 'deleteOne').resolves({ deletedCount: 1 });
    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    stubs.queueEntitiesForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntitiesForIndexing')
      .resolves();
    stubs.updateLotLeaseStatus = this._sandbox.stub(PackedLotDataService, 'updateLotLeaseStatus').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'WhitelistAgreementComponent', 'WhitelistAccountAgreementComponent']);
  });

  describe('processEvent', function () {
    it('should call updateOrCreateFromEvent with component WhitelistAgreement', async function () {
      await (new Handler(whitelistEvent)).processEvent();
      const docs = await mongoose.model('WhitelistAgreementComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('should call updateOrCreateFromEvent with component WhitelistAccountAgreement', async function () {
      await (new Handler(whitelistAccountEvent)).processEvent();
      const docs = await mongoose.model('WhitelistAccountAgreementComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('should call deleteOne if whitelisted is false', async function () {
      whitelistEvent.returnValues.whitelisted = false;
      const handler = new Handler(whitelistEvent);
      await handler.processEvent();

      expect(stubs.deleteOne.calledOnce).to.equal(true);
      expect(stubs.deleteOne.calledWith({
        component: 'WhitelistAgreement',
        data: handler.eventDoc.returnValues
      })).to.equal(true);
    });

    it('should attempt to index related buildings and update the packed lot data', async function () {
      await (new Handler(whitelistEvent)).processEvent();
      expect(stubs.queueEntitiesForIndexing.calledOnce).to.equal(true);
      expect(stubs.updateLotLeaseStatus.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly if an entity is whitelisted', function () {
      const result = Handler.transformEventData(whitelistEvent);

      expect(result).to.deep.equal(whitelistEvent.returnValues);
    });

    it('should transform the data correctly if an account is whitelisted', function () {
      const result = Handler.transformEventData(whitelistAccountEvent);

      expect(result).to.deep.equal(whitelistAccountEvent.returnValues);
    });
  });
});
