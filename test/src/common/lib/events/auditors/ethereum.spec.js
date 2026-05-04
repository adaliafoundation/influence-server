const { expect } = require('chai');
const sinon = require('sinon');
const web3 = require('@common/lib/web3');
const { EthereumBlockCache } = require('@common/lib/cache');
const { ActivityService, EthereumEventService } = require('@common/services');
const EthereumAuditor = require('@common/lib/events/auditors/ethereum');

describe('EthereumAuditor', function () {
  it('should repair finalized blocks whose canonical logs no longer match storage', async function () {
    const sandbox = sinon.createSandbox();
    const chainEvent = {
      blockNumber: 12,
      blockHash: '0xabc',
      event: 'Transfer',
      transactionHash: '0xtx',
      logIndex: 1
    };
    const storedEvent = { ...chainEvent, blockHash: '0xdef' };
    const retriever = {
      forEachBlockRangeBatch: async (_range, fn) => fn({ fromBlock: 12, toBlock: 12 }),
      pullEvents: sandbox.stub().resolves([chainEvent])
    };
    const auditor = new EthereumAuditor({ retriever, finalityBlocks: 10, batchSize: 10 });

    sandbox.stub(web3.eth, 'getBlockNumber').resolves(25);
    sandbox.stub(web3.eth, 'getBlock').resolves({ timestamp: 12345 });
    sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(11);
    sandbox.stub(EthereumBlockCache, 'setFinalizedBlockNumber').resolves();
    sandbox.stub(EthereumBlockCache, 'setFinalizedBlockTimestamp').resolves();
    const setAuditedStub = sandbox.stub(EthereumBlockCache, 'setLastAuditedFinalizedBlock').resolves();
    sandbox.stub(EthereumEventService, 'getEventsByBlockRange').resolves([storedEvent]);
    const removeStub = sandbox.stub(EthereumEventService, 'updateManyAsRemoved').resolves();
    const purgeStub = sandbox.stub(ActivityService, 'purgeByTransactionHashes').resolves();
    const upsertStub = sandbox.stub(EthereumEventService, 'updateOrCreateMany').resolves();
    const resetStub = sandbox.stub(EthereumEventService, 'resetLastProcessedFromBlock').resolves();

    const result = await auditor.auditOnce();

    expect(result.mismatchedBlocks).to.eql(1);
    expect(removeStub.calledOnceWithExactly({
      blockNumber: { $in: [12] },
      removed: { $ne: true }
    })).to.eql(true);
    expect(purgeStub.calledOnceWithExactly(['0xtx'])).to.eql(true);
    expect(upsertStub.calledOnceWithExactly([chainEvent])).to.eql(true);
    expect(resetStub.calledOnceWithExactly(12)).to.eql(true);
    expect(setAuditedStub.calledOnceWithExactly(12)).to.eql(true);

    sandbox.restore();
  });

  it('should bootstrap the ethereum finalized audit checkpoint from the retriever checkpoint', async function () {
    const sandbox = sinon.createSandbox();
    const auditor = new EthereumAuditor({ retriever: {}, finalityBlocks: 10, batchSize: 10 });

    sandbox.stub(EthereumBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
    sandbox.stub(EthereumBlockCache, 'getLastRetrievedBlock').resolves(250);
    sandbox.stub(EthereumEventService, 'getLatestEventByBlock').resolves({ blockNumber: 240 });
    const setStub = sandbox.stub(EthereumBlockCache, 'setLastAuditedFinalizedBlock').resolves();

    const checkpoint = await auditor.ensureBootstrapCheckpoint();

    expect(checkpoint).to.eql(240);
    expect(setStub.calledOnceWithExactly(240)).to.eql(true);

    sandbox.restore();
  });
});
