const { expect } = require('chai');
const StarknetEventService = require('@common/services/Event/Starknet');
const { StarknetEventFactory: EventFactory } = require('../../../../factories');

describe('StarknetEventService', function () {
  let sampleEvents;

  beforeEach(async function () {
    sampleEvents = await Promise.all([
      EventFactory.makeOne({
        blockNumber: 1,
        blockHash: '0x1',
        event: 'Foo',
        logIndex: 1,
        transactionHash: '0x1',
        transactionIndex: 1
      }),
      EventFactory.makeOne({
        blockNumber: 1,
        blockHash: '0x1',
        event: 'Bar',
        logIndex: 1,
        transactionHash: '0x2',
        transactionIndex: 2
      })
    ]);
  });

  afterEach(async function () {
    await EventFactory.purge();
  });

  describe('updateOrCreateMany', function () {
    it('should create events', async function () {
      const result = await StarknetEventService.updateOrCreateMany(sampleEvents);
      expect(result.upserted.length).to.eql(2);
    });

    it('should update existing matching events', async function () {
      await StarknetEventService.updateOrCreateMany(sampleEvents);
      const updatedSampleEvents = sampleEvents.map((e) => ({ ...e.toObject(), status: 'ACCEPTED_ON_L1' }));
      const result = await StarknetEventService.updateOrCreateMany(updatedSampleEvents);
      expect(result.nMatched).to.eql(2);
      expect(result.nModified).to.eql(2);
    });

    it('should upsert repeated Starknet events without creating duplicates', async function () {
      await StarknetEventService.updateOrCreateMany(sampleEvents);

      const repeatedEvents = sampleEvents.map((e) => ({
        ...e.toObject(),
        status: 'ACCEPTED_ON_L1'
      }));

      const result = await StarknetEventService.updateOrCreateMany(repeatedEvents);
      const docs = await EventFactory.getModel().find();

      expect(result.nMatched).to.eql(2);
      expect(result.nModified).to.eql(2);
      expect(docs.length).to.eql(2);
      expect(docs.map((doc) => doc.status)).to.eql(['ACCEPTED_ON_L1', 'ACCEPTED_ON_L1']);
    });
  });

  describe('getLatestEventByBlock', function () {
    it('should ignore legacy pre_confirmed sentinel rows when finding the latest event block', async function () {
      await EventFactory.createOne({
        blockNumber: 100,
        blockHash: '0x100',
        status: 'ACCEPTED_ON_L2',
        event: 'Baz',
        logIndex: 1,
        transactionHash: '0x100',
        transactionIndex: 1
      });
      await EventFactory.createOne({
        blockNumber: Number.MAX_SAFE_INTEGER,
        blockHash: 'PRE_CONFIRMED',
        status: 'PRE_CONFIRMED',
        event: 'Baz',
        logIndex: 2,
        transactionHash: '0x200',
        transactionIndex: 2
      });

      const latest = await StarknetEventService.getLatestEventByBlock();

      expect(latest.blockNumber).to.eql(100);
      expect(latest.blockHash).to.eql('0x100');
    });
  });
});
