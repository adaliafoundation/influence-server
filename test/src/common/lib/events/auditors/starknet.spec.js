const { expect } = require('chai');
const sinon = require('sinon');
const { StarknetBlockCache } = require('@common/lib/cache');
const { ActivityService, StarknetEventService } = require('@common/services');
const StarknetAuditor = require('@common/lib/events/auditors/starknet');

describe('StarknetAuditor', function () {
  it('should use the chain reported l1_accepted block as the finalized frontier', async function () {
    const sandbox = sinon.createSandbox();
    let auditedRange;
    const retriever = {
      forEachBlockRangeBatch: async (range, fn) => {
        auditedRange = range;
        await fn({ fromBlock: range.fromBlock, toBlock: range.toBlock });
      },
      pullAndFormatEvents: sandbox.stub().resolves([]),
      provider: {
        getBlockNumber: sandbox.stub().resolves(150),
        getBlock: sandbox.stub().withArgs('l1_accepted').resolves({ blockNumber: 110 })
      }
    };
    const auditor = new StarknetAuditor({ retriever, batchSize: 200 });

    sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(100);
    sandbox.stub(StarknetBlockCache, 'getLegacyAcceptedL1Block').resolves(undefined);
    sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
    const setAuditedStub = sandbox.stub(StarknetBlockCache, 'setLastAuditedFinalizedBlock').resolves();
    sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([]);
    sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves(null);

    const result = await auditor.auditOnce();

    expect(result.finalizedBlock).to.eql(110);
    expect(auditedRange).to.deep.equal({ fromBlock: 101, toBlock: 110, batchSize: 200 });
    expect(retriever.provider.getBlock.calledOnceWithExactly('l1_accepted')).to.eql(true);
    expect(setAuditedStub.calledOnceWithExactly(110)).to.eql(true);

    sandbox.restore();
  });

  it(
    'should bootstrap the finalized checkpoint from prior Starknet progress and audit only a bounded tail',
    async function () {
      const sandbox = sinon.createSandbox();
      let auditedRange;
      const retriever = {
        forEachBlockRangeBatch: async (range, fn) => {
          auditedRange = range;
          await fn({ fromBlock: range.fromBlock, toBlock: range.toBlock });
        },
        pullAndFormatEvents: sandbox.stub().resolves([]),
        provider: {
          getBlockNumber: sandbox.stub().resolves(150),
          getBlock: sandbox.stub().withArgs('l1_accepted').resolves({ blockNumber: 110 })
        }
      };
      const auditor = new StarknetAuditor({ retriever, batchSize: 200, bootstrapLookbackBlocks: 5 });

      sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(undefined);
      sandbox.stub(StarknetBlockCache, 'getLegacyAcceptedL1Block').resolves(undefined);
      sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(107);
      const setAuditedStub = sandbox.stub(StarknetBlockCache, 'setLastAuditedFinalizedBlock').resolves();
      sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves({ blockNumber: 95 });
      sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([]);

      const result = await auditor.auditOnce();

      expect(result.finalizedBlock).to.eql(110);
      expect(auditedRange).to.deep.equal({ fromBlock: 103, toBlock: 110, batchSize: 200 });
      expect(setAuditedStub.getCall(0).calledWithExactly(102)).to.eql(true);
      expect(setAuditedStub.getCall(setAuditedStub.callCount - 1).calledWithExactly(110)).to.eql(true);

      sandbox.restore();
    }
  );

  it('should purge activities only for the stored transaction hashes in repaired blocks', async function () {
    const sandbox = sinon.createSandbox();
    const canonicalEvent = {
      blockNumber: 40,
      blockHash: '0xabc',
      event: 'CrewStationedV1',
      transactionHash: '0xtx',
      logIndex: 0,
      status: 'ACCEPTED_ON_L1',
      timestamp: 900
    };
    const storedEvent = { ...canonicalEvent, blockHash: '0xdef' };
    const retriever = {
      forEachBlockRangeBatch: async (_range, fn) => fn({ fromBlock: 40, toBlock: 40 }),
      pullAndFormatEvents: sandbox.stub().resolves([canonicalEvent]),
      provider: {
        getBlockNumber: sandbox.stub().resolves(50),
        getBlock: sandbox.stub().withArgs('l1_accepted').resolves({ blockNumber: 40 })
      }
    };
    const auditor = new StarknetAuditor({ retriever, batchSize: 100 });

    sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(39);
    sandbox.stub(StarknetBlockCache, 'setLastAuditedFinalizedBlock').resolves();
    sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([storedEvent]);
    const removeStub = sandbox.stub(StarknetEventService, 'updateManyAsRemoved').resolves();
    const purgeStub = sandbox.stub(ActivityService, 'purgeByTransactionHashes').resolves();
    const upsertStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();
    const resetStub = sandbox.stub(StarknetEventService, 'resetLastProcessedFromBlock').resolves();

    const result = await auditor.auditOnce();

    expect(result.mismatchedBlocks).to.eql(1);
    expect(removeStub.calledOnceWithExactly({
      blockNumber: { $in: [40] },
      removed: { $ne: true }
    })).to.eql(true);
    expect(purgeStub.calledOnceWithExactly(['0xtx'])).to.eql(true);
    expect(upsertStub.calledOnceWithExactly([canonicalEvent])).to.eql(true);
    expect(resetStub.calledOnceWithExactly(40)).to.eql(true);

    sandbox.restore();
  });

  it('should only audit the unknown tail beyond the last audited finalized Starknet block', async function () {
    const sandbox = sinon.createSandbox();
    let auditedRange;
    const retriever = {
      forEachBlockRangeBatch: async (range, fn) => {
        auditedRange = range;
        await fn({ fromBlock: range.fromBlock, toBlock: range.toBlock });
      },
      pullAndFormatEvents: sandbox.stub().resolves([]),
      provider: {
        getBlockNumber: sandbox.stub().resolves(150),
        getBlock: sandbox.stub().withArgs('l1_accepted').resolves({ blockNumber: 130 })
      }
    };
    const auditor = new StarknetAuditor({ retriever, batchSize: 100 });

    sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(120);
    sandbox.stub(StarknetBlockCache, 'getLegacyAcceptedL1Block').resolves(undefined);
    sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
    sandbox.stub(StarknetBlockCache, 'setLastAuditedFinalizedBlock').resolves();
    sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([]);
    sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves(null);

    const result = await auditor.auditOnce();

    expect(result.finalizedBlock).to.eql(130);
    expect(auditedRange).to.deep.equal({ fromBlock: 121, toBlock: 130, batchSize: 100 });
    expect(retriever.provider.getBlock.calledOnceWithExactly('l1_accepted')).to.eql(true);

    sandbox.restore();
  });

  it('should refresh finalized Starknet metadata without destructive repair when identities match', async function () {
    const sandbox = sinon.createSandbox();
    const canonicalEvent = {
      blockNumber: 30,
      blockHash: '0xabc',
      event: 'CrewStationedV1',
      transactionHash: '0xtx',
      logIndex: 0,
      status: 'ACCEPTED_ON_L1',
      timestamp: 900
    };
    const storedEvent = { ...canonicalEvent, status: 'ACCEPTED_ON_L2', timestamp: 850 };
    const retriever = {
      forEachBlockRangeBatch: async (_range, fn) => fn({ fromBlock: 30, toBlock: 30 }),
      pullAndFormatEvents: sandbox.stub().resolves([canonicalEvent]),
      provider: {
        getBlockNumber: sandbox.stub().resolves(50),
        getBlock: sandbox.stub().withArgs('l1_accepted').resolves({ blockNumber: 30 })
      }
    };
    const auditor = new StarknetAuditor({ retriever, batchSize: 100 });

    sandbox.stub(StarknetBlockCache, 'getLastAuditedFinalizedBlock').resolves(29);
    sandbox.stub(StarknetBlockCache, 'getLegacyAcceptedL1Block').resolves(undefined);
    sandbox.stub(StarknetBlockCache, 'getLastRetrievedBlock').resolves(undefined);
    const setAuditedStub = sandbox.stub(StarknetBlockCache, 'setLastAuditedFinalizedBlock').resolves();
    sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([storedEvent]);
    sandbox.stub(StarknetEventService, 'getLatestEventByBlock').resolves(null);
    const removeStub = sandbox.stub(StarknetEventService, 'updateManyAsRemoved').resolves();
    const upsertStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();
    const resetStub = sandbox.stub(StarknetEventService, 'resetLastProcessedFromBlock').resolves();

    const result = await auditor.auditOnce();

    expect(result.finalizedBlock).to.eql(30);
    expect(result.mismatchedBlocks).to.eql(0);
    expect(result.refreshedBlocks).to.eql(1);
    expect(removeStub.called).to.eql(false);
    expect(resetStub.called).to.eql(false);
    expect(upsertStub.calledOnceWithExactly([canonicalEvent])).to.eql(true);
    expect(setAuditedStub.calledOnceWithExactly(30)).to.eql(true);

    sandbox.restore();
  });
});
