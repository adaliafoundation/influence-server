const { expect } = require('chai');
const sinon = require('sinon');
const { EthereumBlockCache } = require('@common/lib/cache');
const { EthereumEventService } = require('@common/services');
const web3 = require('@common/lib/web3');
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
    sandbox.stub(web3.eth, 'getPastLogs').resolves([rawLog]);
    sandbox.stub(EthereumEventsConfig, 'decodeRawLog').returns({ blockNumber: 10, event: 'Transfer' });
    sandbox.stub(EthereumEventsConfig, 'getHandler').returns({
      eventFilter: {},
      parseEvent: sinon.stub().returns(parsedEvent)
    });
    sandbox.stub(EthereumEventsConfig, 'matchesEventFilter').returns(true);

    const events = await retriever.pullEvents({ fromBlock: 10, toBlock: 12 });

    expect(web3.eth.getPastLogs.calledOnceWithExactly({
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
    sandbox.stub(web3.eth, 'getPastLogs').resolves([{ address: '0xabc', topics: ['0xtopic0'] }]);
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
      sandbox.stub(web3.eth, 'getBlockNumber').rejects(new Error('rpc unavailable'));
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
      sandbox.stub(web3.eth, 'getBlockNumber').resolves(950);
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
    sandbox.stub(web3.eth, 'getBlockNumber').resolves(12050);
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
      sandbox.stub(web3.eth, 'getBlockNumber').resolves(12050);
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
