const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService, PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/agreements/Prepaid');
const LeaseExpirationNotificationService = require('@common/services/Notifications/LeaseExpiration');

describe('ComponentUpdated: PrepaidAgreement Handler', function () {
  let event;
  const stubs = {
    updateLotLeaseStatus: null,
    queueEntityForIndexing: null,
    queueEntitiesForIndexing: null,
    leaseExpirationNotificationService: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_PrepaidAgreement',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x3',
        '0x1000000010004',
        '0x1',
        '0x10001',
        '0x1',
        '0x1e',
        '0xa',
        '0x651af72e',
        `0x${(Math.floor(Date.now() / 1000) + 10000).toString(16)}`,
        '0x651af72e'
      ],
      returnValues: {
        entity: { id: 4294967297, label: 4 },
        permission: 1,
        permitted: { id: 1, label: 1 },
        rate: 1,
        initialTerm: 30,
        noticePeriod: 10,
        startTime: 1696266030,
        endTime: Math.floor(Date.now() / 1000) + 10000,
        noticeTime: 1696266030
      }
    });

    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    stubs.queueEntitiesForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntitiesForIndexing')
      .resolves();
    stubs.updateLotLeaseStatus = this._sandbox.stub(PackedLotDataService, 'updateLotLeaseStatus').resolves();
    stubs.leaseExpirationNotificationService = this._sandbox
      .stub(LeaseExpirationNotificationService, 'createOrUpdate')
      .resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['LeaseExpirationNotification', 'PrepaidAgreementComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the PrepaidAgreementComponent doc', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('PrepaidAgreementComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
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

    it('should create a notification', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.leaseExpirationNotificationService.calledOnce).to.equal(true);
    });

    it('should clear the status if the endTime is greater than the current endTime', async function () {
      await mongoose.model('PrepaidAgreementComponent').create({
        entity: { id: 4294967297, label: 4 },
        permission: 1,
        permitted: { id: 1, label: 1 },
        rate: 1,
        initialTerm: 30,
        noticePeriod: 10,
        startTime: 1696266030,
        endTime: Math.floor(Date.now() / 1000) - 10000,
        noticeTime: 1696266030,
        status: 'TRANSFERRED'
      });

      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('PrepaidAgreementComponent').find().lean();
      expect(docs[0].status).to.equal(undefined);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
