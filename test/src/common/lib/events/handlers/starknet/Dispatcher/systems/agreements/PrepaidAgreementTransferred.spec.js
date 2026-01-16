const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const { PrepaidAgreementTransferred: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('Dispatcher::PrepaidAgreementTransferred Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'PrepaidAgreementTransferred',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x4', '0x2', // target
        '0x1', // permission
        '0x1', '0x1', // permitted
        '0x1', '0x3', // oldPermitted
        '0x1', // term
        '0x1', // rate
        '0x1', // initialTerm
        '0x1', // noticePeriod
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        target: { label: 4, id: 2 },
        permission: 1,
        permitted: { label: 1, id: 1 },
        oldPermitted: { label: 1, id: 3 },
        term: 1,
        rate: 1,
        initialTerm: 1,
        noticePeriod: 1,
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('PrepaidAgreementComponent').create([
      {
        entity: { label: 4, id: 2 },
        permitted: { label: 1, id: 3 },
        permission: 1,
        endTime: moment().add(30, 'day').unix(),
        initialTerm: 1,
        noticePeriod: 1,
        noticeTime: moment().add(1, 'day').unix(),
        rate: 1,
        startTime: moment().unix()
      },
      {
        entity: { label: 4, id: 2 },
        permitted: { label: 1, id: 1 },
        permission: 1,
        endTime: moment().add(30, 'day').unix(),
        initialTerm: 1,
        noticePeriod: 1,
        noticeTime: moment().add(1, 'day').unix(),
        rate: 1,
        startTime: moment().unix()
      }
    ]);
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'IndexItem', 'PrepaidAgreementComponent']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should update the coresponding Component document correctly', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      const docs = await mongoose.model('PrepaidAgreementComponent').find();
      const perviousDoc = docs.find((doc) => (
        doc.entity.uuid === '0x20004'
        && doc.permission === 1
        && doc.permitted.uuid === '0x30001'
      ));
      const newDoc = docs.find((doc) => (
        doc.entity.uuid === '0x20004'
        && doc.permission === 1
        && doc.permitted.uuid === '0x10001'
      ));
      expect(perviousDoc.status).to.equal('TRANSFERRED');
      expect(newDoc.status).to.equal(undefined);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
