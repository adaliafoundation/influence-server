const { expect } = require('chai');
const sinon = require('sinon');
const { StarknetBlockCache } = require('@common/lib/cache');
const EventService = require('@common/services/Event');
const eventEmitter = require('@common/lib/sio/emitter');
const EventProcessor = require('@common/lib/events/processor/EventProcessor');

describe('EventProcessor', function () {
  let processor;
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    processor = new EventProcessor({ runDelay: 5000, batchSize: 100 });
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('emitCachedStarknetBlockNumber', function () {
    it('should emit the cached current starknet block number with the current block timestamp', async function () {
      sandbox.stub(StarknetBlockCache, 'getCurrentBlockNumber').resolves(9542288);
      sandbox.stub(StarknetBlockCache, 'getLastEmittedCurrentBlockNumber').resolves(9542286);
      sandbox.stub(StarknetBlockCache, 'getCurrentBlockTimestamp').resolves(1778144596);
      const broadcastStub = sandbox.stub(eventEmitter, 'broadcast').resolves();
      const setLastEmittedStub = sandbox.stub(StarknetBlockCache, 'setLastEmittedCurrentBlockNumber').resolves();

      const emitted = await processor.emitCachedStarknetBlockNumber();

      expect(emitted).to.equal(true);
      expect(broadcastStub.calledOnceWithExactly({
        type: 'CURRENT_STARKNET_BLOCK_NUMBER',
        body: {
          blockNumber: 9542288,
          previous: 9542286,
          blockTimestamp: 1778144596
        }
      })).to.equal(true);
      expect(setLastEmittedStub.calledOnceWithExactly(9542288)).to.equal(true);
    });

    it('should not emit when the cached current starknet block has already been emitted', async function () {
      sandbox.stub(StarknetBlockCache, 'getCurrentBlockNumber').resolves(9542288);
      sandbox.stub(StarknetBlockCache, 'getLastEmittedCurrentBlockNumber').resolves(9542288);
      const broadcastStub = sandbox.stub(eventEmitter, 'broadcast').resolves();

      const emitted = await processor.emitCachedStarknetBlockNumber();

      expect(emitted).to.equal(false);
      expect(broadcastStub.called).to.equal(false);
    });
  });

  describe('emitCachedStarknetBlockNumberIfCaughtUp', function () {
    it(
      'should emit the cached current starknet block number when there is no remaining processor backlog',
      async function () {
        sandbox.stub(EventService, 'getNonProcessed').resolves([]);
        const emitStub = sandbox.stub(processor, 'emitCachedStarknetBlockNumber').resolves(true);

        const emitted = await processor.emitCachedStarknetBlockNumberIfCaughtUp();

        expect(emitted).to.equal(true);
        expect(emitStub.calledOnce).to.equal(true);
      }
    );

    it(
      'should not emit the cached current starknet block number when there is remaining processor backlog',
      async function () {
        sandbox.stub(EventService, 'getNonProcessed').resolves([{ _id: 'evt1' }]);
        const emitStub = sandbox.stub(processor, 'emitCachedStarknetBlockNumber').resolves(true);

        const emitted = await processor.emitCachedStarknetBlockNumberIfCaughtUp();

        expect(emitted).to.equal(false);
        expect(emitStub.called).to.equal(false);
      }
    );
  });

  describe('scheduleNextRun', function () {
    it('should rerun immediately when the processor consumes a full batch', async function () {
      const mainStub = sandbox.stub(processor, 'main').resolves('rerun');

      const result = await processor.scheduleNextRun({
        timerMs: 10,
        eventsLength: 100
      });

      expect(result).to.equal('rerun');
      expect(mainStub.calledOnceWithExactly({ timeStamp: undefined })).to.equal(true);
    });

    it(
      'should delay before rerunning when the processor is under the batch limit and under run delay',
      async function () {
        const clock = sandbox.useFakeTimers();
        const mainStub = sandbox.stub(processor, 'main').resolves('rerun');
        const schedulePromise = processor.scheduleNextRun({
          timerMs: 10,
          eventsLength: 99
        });

        expect(mainStub.called).to.equal(false);
        await clock.tickAsync(4990);

        const result = await schedulePromise;

        expect(result).to.equal('rerun');
        expect(mainStub.calledOnceWithExactly({ timeStamp: undefined })).to.equal(true);
      }
    );
  });

  describe('main', function () {
    it('reports successful idle progress only after processing and emission complete', async function () {
      sandbox.stub(EventService, 'getNonProcessed').resolves([]);
      const processed = sandbox.stub(processor, 'process').resolves();
      const emitted = sandbox.stub(processor, 'emitCachedStarknetBlockNumberIfCaughtUp').resolves();
      sandbox.stub(processor, 'scheduleNextRun').resolves();
      processor.onHealthy = sandbox.stub().resolves();
      await processor.main();
      expect(processed.calledBefore(processor.onHealthy)).to.equal(true);
      expect(emitted.calledBefore(processor.onHealthy)).to.equal(true);
    });

    it('does not report healthy after a processing failure', async function () {
      sandbox.stub(EventService, 'getNonProcessed').resolves([]);
      const failure = new Error('processing failed');
      sandbox.stub(processor, 'process').rejects(failure);
      processor.onHealthy = sandbox.stub().resolves();
      try {
        await processor.main();
        throw new Error('Expected processing failure');
      } catch (error) {
        expect(error).to.equal(failure);
      }
      expect(processor.onHealthy.called).to.equal(false);
    });

    it('should fetch non-processed events using the capped batch size', async function () {
      sandbox.stub(EventService, 'getNonProcessed').resolves([]);
      const processStub = sandbox.stub(processor, 'process').resolves();
      const emitStub = sandbox.stub(processor, 'emitCachedStarknetBlockNumberIfCaughtUp').resolves(false);
      const scheduleStub = sandbox.stub(processor, 'scheduleNextRun').resolves('scheduled');

      const result = await processor.main();

      expect(result).to.equal('scheduled');
      expect(EventService.getNonProcessed.calledOnceWithExactly({ limit: 100 })).to.equal(true);
      expect(processStub.calledOnceWithExactly({ events: [] })).to.equal(true);
      expect(emitStub.calledOnce).to.equal(true);
      expect(scheduleStub.calledOnce).to.equal(true);
    });
  });
});
