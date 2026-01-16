/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Sway/WithdrawInitiated');

describe('Starknet::Sway::WithdrawInitiated Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'WithdrawInitiated',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0xE88210749F561CCB7839593E99b00414699a80DD',
        '0x1e240',
        '0x0',
        '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      ],
      returnValues: {
        l1Recipient: '0xe88210749f561ccb7839593e99b00414699a80dd',
        amount: '0x1e240',
        callerAddress: '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Event', 'SwayCrossing']);
  });

  describe('processEvent', function () {
    it('should create a SwayCrossing document if one does not exist', async function () {
      const handler = new Handler(event);
      await handler.processEvent();

      const docs = await mongoose.model('SwayCrossing').find();
      expect(docs.length).to.equal(1);
      expect(docs[0].pendingCount).to.equal(1);
      expect(docs[0].events.length).to.equal(1);
      expect(docs[0].events[0].transactionHash).to
        .equal('0x0000000000000000000000000000000000000000000000000000000123456789');
      expect(docs[0].events[0].logIndex).to.equal(1);
    });

    it('should not recreate a new sway crossing doc if one already exits', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      await handler.processEvent();

      const docs = await mongoose.model('SwayCrossing').find();
      expect(docs.length).to.equal(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
