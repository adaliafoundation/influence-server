const { expect } = require('chai');
const appConfig = require('config');
const sinon = require('sinon');
const { EthereumBlockCache } = require('@common/lib/cache');
const { EthereumEventService } = require('@common/services');
const EthereumRpc = require('@common/lib/ethereum/Rpc');
const { EthereumRetriever } = require('@common/lib/events/retrievers/ethereum/retriever');
const EthereumEventsConfig = require('@common/lib/events/retrievers/ethereum/config');

describe('Ethereum Event Retriever', function () {
  let retriever;
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    retriever = new EthereumRetriever();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('worker health reporting', function () {
    for (const idle of [true, false]) {
      // eslint-disable-next-line no-loop-func
      it(`reports success after a ${idle ? 'healthy idle' : 'persisted batch'} iteration`, async function () {
        const stop = new Error('stop test runner');
        const head = Number(appConfig.Ethereum.originBlock) + 100;
        const rpc = sandbox.stub(EthereumRpc, 'getBlockNumber');
        rpc.onFirstCall().resolves(head);
        rpc.onSecondCall().rejects(stop);
        sandbox.stub(retriever, 'cacheCurrentBlockNumber').resolves();
        sandbox.stub(retriever, 'ensureBootstrapCheckpoint').resolves(idle ? head : head - 1);
        sandbox.stub(retriever, 'pullEvents').resolves([]);
        const checkpoint = sandbox.stub(EthereumBlockCache, 'setLastRetrievedBlock').resolves();
        const onHealthy = sandbox.stub().resolves();
        const onFailure = sandbox.stub().rejects(stop);
        try {
          await retriever.runner({ runDelay: 1, onHealthy, onFailure });
          throw new Error('Expected the test runner to stop');
        } catch (error) {
          expect(error).to.equal(stop);
        }
        expect(onHealthy.calledOnce).to.equal(true);
        expect(onFailure.calledOnce).to.equal(true);
        if (!idle) expect(checkpoint.calledBefore(onHealthy)).to.equal(true);
      });
    }

    it('does not report success when RPC fails', async function () {
      const stop = new Error('stop test runner');
      sandbox.stub(EthereumRpc, 'getBlockNumber').rejects(stop);
      const onHealthy = sandbox.stub().resolves();
      const onFailure = sandbox.stub().rejects(stop);
      try {
        await retriever.runner({ runDelay: 1, onHealthy, onFailure });
        throw new Error('Expected the test runner to stop');
      } catch (error) {
        expect(error).to.equal(stop);
      }
      expect(onHealthy.called).to.equal(false);
      expect(onFailure.calledOnce).to.equal(true);
    });
  });

  describe('getCatchUpDelay', function () {
    it('should use the configured catch-up delay when provided', function () {
      appConfig.EventRetriever.ethereum.catchUpDelay = 1500;

      expect(retriever.getCatchUpDelay()).to.eql(1500);
    });

    it('should use the default catch-up delay when not configured', function () {
      appConfig.EventRetriever.ethereum.catchUpDelay = null;

      expect(retriever.getCatchUpDelay()).to.eql(1500);
    });
  });

  it('should fetch logs once for the whole tracked address/topic set and decode locally', async function () {
    const parsedEvent = { event: 'Transfer', blockNumber: 10 };
    const rawLog = {
      address: '0xabc',
      topics: ['0xtopic0'],
      data: '0x0',
      blockHash: '0xblock',
      blockNumber: 10,
      logIndex: 1,
      transactionHash: '0xtx',
      transactionIndex: 2
    };

    sandbox.stub(EthereumEventsConfig, 'getTrackedAddresses').returns(['0xabc', '0xdef']);
    sandbox.stub(EthereumEventsConfig, 'getTrackedTopics').returns(['0xtopic0', '0xtopic1']);
    sandbox.stub(EthereumRpc, 'getPastLogs').resolves([rawLog]);
    sandbox.stub(EthereumEventsConfig, 'decodeRawLog').returns({ blockNumber: 10, event: 'Transfer' });
    sandbox.stub(EthereumEventsConfig, 'getHandler').returns({
      eventFilter: {},
      parseEvent: sinon.stub().returns(parsedEvent)
    });
    sandbox.stub(EthereumEventsConfig, 'matchesEventFilter').returns(true);

    const events = await retriever.pullEvents({ fromBlock: 10, toBlock: 12 });

    expect(EthereumRpc.getPastLogs.calledOnceWithExactly({
      address: ['0xabc', '0xdef'],
      fromBlock: 10,
      toBlock: 12,
      topics: [['0xtopic0', '0xtopic1']]
    })).to.eql(true);
    expect(events).to.eql([parsedEvent]);
  });

  it('should post-filter deprecated and unmatched events after decoding', async function () {
    sandbox.stub(EthereumEventsConfig, 'getTrackedAddresses').returns(['0xabc']);
    sandbox.stub(EthereumEventsConfig, 'getTrackedTopics').returns(['0xtopic0']);
    sandbox.stub(EthereumRpc, 'getPastLogs').resolves([{ address: '0xabc', topics: ['0xtopic0'] }]);
    sandbox.stub(EthereumEventsConfig, 'decodeRawLog').returns({ blockNumber: 20, event: 'Transfer' });
    sandbox.stub(EthereumEventsConfig, 'getHandler').returns({
      eventFilter: { DEPRECATED_AT: 20 },
      parseEvent: sinon.stub().returns({ event: 'Transfer' })
    });
    const matchesStub = sandbox.stub(EthereumEventsConfig, 'matchesEventFilter').returns(false);

    const events = await retriever.pullEvents({ fromBlock: 20, toBlock: 20 });

    expect(events).to.eql([]);
    expect(matchesStub.called).to.eql(false);
  });

  it(
    'should bootstrap the last retrieved checkpoint from stored ethereum events when head lookup is unavailable',
    async function () {
      sandbox.stub(EthereumBlockCache, 'getLastRetrievedBlock').resolves(undefined);
      sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
      sandbox.stub(EthereumRpc, 'getBlockNumber').rejects(new Error('rpc unavailable'));
      sandbox.stub(EthereumEventService, 'getLatestEventByBlock').resolves({ blockNumber: 321 });
      const setStub = sandbox.stub(EthereumBlockCache, 'setLastRetrievedBlock').resolves();

      const checkpoint = await retriever.ensureBootstrapCheckpoint();

      expect(checkpoint).to.eql(321);
      expect(setStub.calledOnceWithExactly(321)).to.eql(true);
    }
  );

  it(
    'should prefer the audited finalized checkpoint when bootstrapping after retriever checkpoint loss',
    async function () {
      sandbox.stub(EthereumBlockCache, 'getLastRetrievedBlock').resolves(undefined);
      sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(900);
      sandbox.stub(EthereumRpc, 'getBlockNumber').resolves(950);
      sandbox.stub(EthereumEventService, 'getLatestEventByBlock').resolves({ blockNumber: 700 });
      const setStub = sandbox.stub(EthereumBlockCache, 'setLastRetrievedBlock').resolves();

      const checkpoint = await retriever.ensureBootstrapCheckpoint();

      expect(checkpoint).to.eql(900);
      expect(setStub.calledOnceWithExactly(900)).to.eql(true);
    }
  );

  it('should fall back to a bounded head lookback when no checkpoints or stored events exist', async function () {
    sandbox.stub(EthereumBlockCache, 'getLastRetrievedBlock').resolves(undefined);
    sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
    sandbox.stub(EthereumRpc, 'getBlockNumber').resolves(12050);
    sandbox.stub(EthereumEventService, 'getLatestEventByBlock').resolves(null);
    const setStub = sandbox.stub(EthereumBlockCache, 'setLastRetrievedBlock').resolves();

    const checkpoint = await retriever.ensureBootstrapCheckpoint();

    expect(checkpoint).to.eql(2050);
    expect(setStub.calledOnceWithExactly(2050)).to.eql(true);
  });

  it(
    'should prefer the bounded head lookback over a stale latest event when no audited checkpoint exists',
    async function () {
      sandbox.stub(EthereumBlockCache, 'getLastRetrievedBlock').resolves(undefined);
      sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
      sandbox.stub(EthereumRpc, 'getBlockNumber').resolves(12050);
      sandbox.stub(EthereumEventService, 'getLatestEventByBlock').resolves({ blockNumber: 321 });
      const setStub = sandbox.stub(EthereumBlockCache, 'setLastRetrievedBlock').resolves();

      const checkpoint = await retriever.ensureBootstrapCheckpoint();

      expect(checkpoint).to.eql(2050);
      expect(setStub.calledOnceWithExactly(2050)).to.eql(true);
    }
  );

  it('should update the cached ethereum head block number when it changes', async function () {
    sandbox.stub(EthereumBlockCache, 'getCurrentBlockNumber').resolves(122);
    const setStub = sandbox.stub(EthereumBlockCache, 'setCurrentBlockNumber').resolves();

    await retriever.cacheCurrentBlockNumber(123);

    expect(setStub.calledOnceWithExactly(123)).to.eql(true);
  });

  it('should not update the cached ethereum head block number when it is unchanged', async function () {
    sandbox.stub(EthereumBlockCache, 'getCurrentBlockNumber').resolves(123);
    const setStub = sandbox.stub(EthereumBlockCache, 'setCurrentBlockNumber').resolves();

    await retriever.cacheCurrentBlockNumber(123);

    expect(setStub.called).to.eql(false);
  });
});
