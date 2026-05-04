const { expect } = require('chai');
const sinon = require('sinon');
const appConfig = require('config');
const { StarknetBlockCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');
const { StarknetEventService } = require('@common/services');
const { StarknetRetriever } = require('@common/lib/events/retrievers/starknet/retriever');
const StarknetEventConfig = require('../../../../../../../src/common/lib/events/retrievers/starknet/config');

class FakeHandler {
  static ignore = true;

  static parseEvent(event) {
    return event;
  }
}

describe('Starknet Event Retriever', function () {
  let retriever;
  let configState;
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  before(function () {
    configState = appConfig.util.cloneDeep(appConfig);

    appConfig.Starknet.rpcProvider = 'FAKE_STARKNET_RPC_PROVIDER';
    appConfig.Starknet.originBlock = 1;

    retriever = new StarknetRetriever();
  });

  after(function () {
    Object.assign(appConfig, configState);
  });

  describe('pullAndFormatEvents', function () {
    beforeEach(function () {
      sandbox.stub(logger, 'info');
      sandbox.stub(logger, 'debug');
      sandbox.stub(StarknetEventConfig, 'toArray').returns([{
        address: '0x1',
        handlers: { '0x1': FakeHandler }
      }]);

      sandbox.stub(retriever.provider, 'getEvents').resolves([{
        address: '0x1',
        data: [],
        keys: ['0x1']
      }]);

      sandbox.stub(StarknetEventConfig, 'getHandler').returns(FakeHandler);
    });

    it('should skip events with ignore: true', async function () {
      const results = await retriever.pullAndFormatEvents({ blockNumber: 1 });
      expect(results.length).to.eql(0);
    });

    it('should not skip events with ignore: false or undefined', async function () {
      FakeHandler.ignore = false;
      let results = await retriever.pullAndFormatEvents({ blockNumber: 1 });
      expect(results.length).to.eql(1);

      FakeHandler.ignore = undefined;
      results = await retriever.pullAndFormatEvents({ blockNumber: 1 });
      expect(results.length).to.eql(1);
    });

    it('should summarize unhandled events at info and only log raw payloads at debug', async function () {
      const unhandledEvent = {
        address: '0x2',
        blockNumber: 10,
        data: ['0x1'],
        keys: ['0xabc'],
        transactionHash: '0xdeadbeef'
      };

      retriever.provider.getEvents.restore();
      StarknetEventConfig.getHandler.restore();
      sandbox.stub(retriever.provider, 'getEvents').resolves([unhandledEvent, unhandledEvent]);
      sandbox.stub(StarknetEventConfig, 'getHandler').returns(null);

      const results = await retriever.pullAndFormatEvents({ fromBlock: 10, toBlock: 20 });
      const expectedSummary = /skipped \[2\] unhandled event\(s\) on \[10 -> 20\] across \[1\] selector group\(s\)/;

      expect(results).to.eql([]);
      expect(logger.info.calledWithMatch(expectedSummary)).to.eql(true);
      expect(
        logger.debug.calledWithMatch(/unhandled selector summary address=0x2 selector=0xabc count=2/)
      ).to.eql(true);
      expect(
        logger.debug.calledWithMatch(/Unable to find handler for event: /)
      ).to.eql(true);
    });
  });

  describe('runOnce', function () {
    it('should process from/to in range batches when onlyMisingBlocks is false', async function () {
      const retrieveStub = sandbox.stub(retriever, 'retrieveAndProcessRange').resolves(0);
      const hasEventsStub = sandbox.stub(StarknetEventService, 'hasEventsForBlock');

      await retriever.runOnce({ fromBlock: 1, toBlock: 2500, onlyMisingBlocks: false });

      expect(hasEventsStub.called).to.eql(false);
      expect(retrieveStub.callCount).to.eql(3);
      expect(retrieveStub.getCall(0).calledWithExactly({ fromBlock: 1, toBlock: 1000 })).to.eql(true);
      expect(retrieveStub.getCall(1).calledWithExactly({ fromBlock: 1001, toBlock: 2000 })).to.eql(true);
      expect(retrieveStub.getCall(2).calledWithExactly({ fromBlock: 2001, toBlock: 2500 })).to.eql(true);
    });

    it('should keep per-block checks when onlyMisingBlocks is true', async function () {
      const retrieveStub = sandbox.stub(retriever, 'retrieveAndProcessRange').resolves(0);
      const hasEventsStub = sandbox.stub(StarknetEventService, 'hasEventsForBlock');
      hasEventsStub.withArgs(1).resolves(true);
      hasEventsStub.withArgs(2).resolves(false);
      hasEventsStub.withArgs(3).resolves(true);

      await retriever.runOnce({ fromBlock: 1, toBlock: 3, onlyMisingBlocks: true });

      expect(hasEventsStub.callCount).to.eql(3);
      expect(retrieveStub.callCount).to.eql(1);
      expect(retrieveStub.getCall(0).calledWithExactly({ fromBlock: 2, toBlock: 2 })).to.eql(true);
    });
  });

  describe('retrieveAndProcessRange', function () {
    it('should save pulled events and return the count', async function () {
      const event = { blockNumber: 10, transactionHash: '0x1', logIndex: 0 };
      sandbox.stub(retriever, 'pullAndFormatEvents').resolves([event]);
      const saveStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();

      const count = await retriever.retrieveAndProcessRange({ fromBlock: 10, toBlock: 10 });

      expect(count).to.eql(1);
      expect(saveStub.calledOnceWithExactly([event])).to.eql(true);
    });

    it('should skip writes when no events are found', async function () {
      sandbox.stub(retriever, 'pullAndFormatEvents').resolves([]);
      const saveStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();

      const count = await retriever.retrieveAndProcessRange({ fromBlock: 10, toBlock: 10 });

      expect(count).to.eql(0);
      expect(saveStub.called).to.eql(false);
    });
  });

  describe('ensureBootstrapCheckpoint', function () {
    it(
      'should bootstrap the last retrieved checkpoint from stored starknet events when head lookup is unavailable',
      async function () {
        sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
        sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
        sandbox.stub(retriever.provider, 'getBlockNumber').rejects(new Error('rpc unavailable'));
        sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves({ blockNumber: 654 });
        const setStub = sandbox.stub(StarknetBlockCache, 'setLastRetrievedBlock').resolves();

        const checkpoint = await retriever.ensureBootstrapCheckpoint();

        expect(checkpoint).to.eql(654);
        expect(setStub.calledOnceWithExactly(654)).to.eql(true);
      }
    );

    it(
      'should prefer the audited finalized checkpoint when bootstrapping after retriever checkpoint loss',
      async function () {
        sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
        sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(1900);
        sandbox.stub(retriever.provider, 'getBlockNumber').resolves(2000);
        sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves({ blockNumber: 1200 });
        const setStub = sandbox.stub(StarknetBlockCache, 'setLastRetrievedBlock').resolves();

        const checkpoint = await retriever.ensureBootstrapCheckpoint();

        expect(checkpoint).to.eql(1900);
        expect(setStub.calledOnceWithExactly(1900)).to.eql(true);
      }
    );

    it('should fall back to a bounded head lookback when no checkpoints or stored events exist', async function () {
      sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
      sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
      sandbox.stub(retriever.provider, 'getBlockNumber').resolves(26000);
      sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves(null);
      const setStub = sandbox.stub(StarknetBlockCache, 'setLastRetrievedBlock').resolves();

      const checkpoint = await retriever.ensureBootstrapCheckpoint();

      expect(checkpoint).to.eql(1000);
      expect(setStub.calledOnceWithExactly(1000)).to.eql(true);
    });

    it(
      'should prefer the bounded head lookback over a stale latest event when no audited checkpoint exists',
      async function () {
        sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
        sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
        sandbox.stub(retriever.provider, 'getBlockNumber').resolves(26000);
        sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves({ blockNumber: 654 });
        const setStub = sandbox.stub(StarknetBlockCache, 'setLastRetrievedBlock').resolves();

        const checkpoint = await retriever.ensureBootstrapCheckpoint();

        expect(checkpoint).to.eql(1000);
        expect(setStub.calledOnceWithExactly(1000)).to.eql(true);
      }
    );
  });
});
