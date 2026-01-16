const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/agreements/PrepaidAgreementCancelled');

describe('PrepaidAgreementCancelled Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'PrepaidAgreementCancelled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x4', '0x1',
        '0x1',
        '0x1', '0x2',
        '0x6536a960',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        target: { label: 4, id: 1 },
        permission: 1,
        permitted: { label: 1, id: 2 },
        evictionTime: 1698081120,
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('PrepaidAgreementComponent').create({
      entity: { label: 4, id: 1 },
      permitted: { label: 1, id: 2 },
      permission: 1,
      endTime: moment().add(30, 'day').unix(),
      initialTerm: 1,
      noticePeriod: 1,
      noticeTime: moment().add(1, 'day').unix(),
      rate: 1,
      startTime: moment().unix()
    });
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
      const docs = await mongoose.model('PrepaidAgreementComponent').find({});
      expect(docs[0].status).to.equal('CANCELLED');
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
