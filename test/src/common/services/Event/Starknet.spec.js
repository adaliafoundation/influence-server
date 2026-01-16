const { expect } = require('chai');
const mongoose = require('mongoose');
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

    it('should match on and update matching "pending" documents', async function () {
      const pendingEvents = sampleEvents.map((e) => ({
        ...e.toObject(), blockHash: 'PENDING', blockNumber: Number.MAX_SAFE_INTEGER, status: 'PENDING'
      }));

      await StarknetEventService.updateOrCreateMany(pendingEvents);
      await StarknetEventService.updateOrCreateMany(pendingEvents);
      const result = await StarknetEventService.updateOrCreateMany(sampleEvents);

      const docs = await mongoose.model('Event').find();
      expect(result.nMatched).to.eql(2);
      expect(result.nModified).to.eql(2);
      expect(docs.map((doc) => doc.blockHash)).to.eql(['0x1', '0x1']);
      expect(docs.map((doc) => doc.blockNumber)).to.eql([1, 1]);
      expect(docs.map((doc) => doc.status)).to.eql(['ACCEPTED_ON_L2', 'ACCEPTED_ON_L2']);
    });

    it('should update non pending events and fail gracefully on duplicate pending events', async function () {
      const events = sampleEvents.map((e) => ({
        ...e.toObject(), status: 'PENDING', blockHash: 'PENDING', blockNumber: Number.MAX_SAFE_INTEGER
      }));
      await StarknetEventService.updateOrCreateMany(events);

      // convert one event to ACCEPTED_ON_L2
      Object.assign(events[0], { blockHash: '0x234234', blockNumber: 1, status: 'ACCEPTED_ON_L2' });

      const r = await StarknetEventService.updateOrCreateMany(events);
      expect(r.writeErrors.length).to.eql(1);
      expect(r.nMatched).to.eql(1);
      expect(r.nModified).to.eql(1);
      const docs = await EventFactory.getModel().find();
      expect(docs.map((doc) => doc.status)).to.deep.include('ACCEPTED_ON_L2');
      expect(docs.map((doc) => doc.status)).to.deep.include('PENDING');
      expect(docs.length).to.eql(2);
    });
  });
});
