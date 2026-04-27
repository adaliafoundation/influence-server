const { expect } = require('chai');
const sinon = require('sinon');
const appConfig = require('config');
const {
  ActivityService,
  StarknetEventService,
  StarknetReconciliationBlockService
} = require('@common/services');
const { StarknetRetriever } = require('@common/lib/events/retrievers/starknet/retriever');
const StarknetEventConfig = require('../../../../../../../src/common/lib/events/retrievers/starknet/config');

class FakeHandler {
  static ignore = true;

  static parseEvent() {
    return {};
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
  });

  describe('auditOnce', function () {
    it('should reconcile a mismatched block', async function () {
      const chainEvent = {
        blockNumber: 12,
        event: 'CrewStationedV1',
        transactionHash: '0x1',
        logIndex: 0,
        blockHash: '0xabc'
      };
      const storedEvent = { ...chainEvent, blockHash: '0xdef' };

      sandbox.stub(retriever.provider, 'getBlockNumber').resolves(15);
      sandbox.stub(retriever, 'pullAndFormatEvents').resolves([chainEvent]);
      sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([storedEvent]);
      const removeStub = sandbox.stub(StarknetEventService, 'updateManyAsRemoved').resolves();
      const purgeStub = sandbox.stub(ActivityService, 'purgeByRemoved').resolves();
      const upsertStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();
      sandbox.stub(retriever, 'reconcileTrackedBlocks').resolves({ checkedBlocks: 0, reorgStartBlock: null });
      sandbox.stub(retriever, 'syncReconciliationBlocks').resolves();
      sandbox.stub(retriever, 'removeReconciliationBlocks').resolves();

      const result = await retriever.auditOnce({ blockOffset: 10 });

      expect(result.startBlock).to.eql(5);
      expect(result.headBlock).to.eql(15);
      expect(result.mismatchedBlocks).to.eql(1);
      expect(removeStub.calledOnceWithExactly({ blockNumber: 12 })).to.eql(true);
      expect(purgeStub.calledOnce).to.eql(true);
      expect(upsertStub.calledOnceWithExactly([chainEvent])).to.eql(true);
    });

    it('should not reconcile matching blocks', async function () {
      const chainEvent = {
        blockNumber: 14,
        event: 'CrewStationedV1',
        transactionHash: '0x2',
        logIndex: 1,
        blockHash: '0x999'
      };

      sandbox.stub(retriever.provider, 'getBlockNumber').resolves(20);
      sandbox.stub(retriever, 'pullAndFormatEvents').resolves([chainEvent]);
      sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([chainEvent]);
      const removeStub = sandbox.stub(StarknetEventService, 'updateManyAsRemoved').resolves();
      const purgeStub = sandbox.stub(ActivityService, 'purgeByRemoved').resolves();
      const upsertStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();
      sandbox.stub(retriever, 'reconcileTrackedBlocks').resolves({ checkedBlocks: 0, reorgStartBlock: null });
      sandbox.stub(retriever, 'syncReconciliationBlocks').resolves();
      sandbox.stub(retriever, 'removeReconciliationBlocks').resolves();

      const result = await retriever.auditOnce({ blockOffset: 10 });

      expect(result.startBlock).to.eql(10);
      expect(result.headBlock).to.eql(20);
      expect(result.mismatchedBlocks).to.eql(0);
      expect(removeStub.called).to.eql(false);
      expect(purgeStub.called).to.eql(false);
      expect(upsertStub.called).to.eql(false);
    });

    it('should process large audit ranges in batches', async function () {
      sandbox.stub(retriever.provider, 'getBlockNumber').resolves(1002);
      const pullStub = sandbox.stub(retriever, 'pullAndFormatEvents').resolves([]);
      const storedStub = sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([]);
      const removeStub = sandbox.stub(StarknetEventService, 'updateManyAsRemoved').resolves();
      const purgeStub = sandbox.stub(ActivityService, 'purgeByRemoved').resolves();
      const upsertStub = sandbox.stub(StarknetEventService, 'updateOrCreateMany').resolves();
      sandbox.stub(retriever, 'reconcileTrackedBlocks').resolves({ checkedBlocks: 0, reorgStartBlock: null });
      sandbox.stub(retriever, 'syncReconciliationBlocks').resolves();
      sandbox.stub(retriever, 'removeReconciliationBlocks').resolves();

      const result = await retriever.auditOnce({ blockOffset: 1001 });

      expect(result.startBlock).to.eql(1);
      expect(result.headBlock).to.eql(1002);
      expect(result.mismatchedBlocks).to.eql(0);

      expect(pullStub.callCount).to.eql(2);
      expect(pullStub.getCall(0).calledWithExactly({ fromBlock: 1, toBlock: 1000 })).to.eql(true);
      expect(pullStub.getCall(1).calledWithExactly({ fromBlock: 1001, toBlock: 1002 })).to.eql(true);

      expect(storedStub.callCount).to.eql(2);
      expect(storedStub.getCall(0).calledWithExactly(1, 1000)).to.eql(true);
      expect(storedStub.getCall(1).calledWithExactly(1001, 1002)).to.eql(true);

      expect(removeStub.called).to.eql(false);
      expect(purgeStub.called).to.eql(false);
      expect(upsertStub.called).to.eql(false);
    });

    it('should replay from detected reorg start block', async function () {
      sandbox.stub(retriever.provider, 'getBlockNumber').resolves(200);
      sandbox.stub(retriever, 'pullAndFormatEvents').resolves([]);
      sandbox.stub(StarknetEventService, 'getEventsByBlockRange').resolves([]);
      const replayStub = sandbox.stub(retriever, 'replayRangeFromBlock').resolves();
      sandbox.stub(retriever, 'reconcileTrackedBlocks').resolves({ checkedBlocks: 1, reorgStartBlock: 150 });

      const result = await retriever.auditOnce({ blockOffset: 10 });

      expect(replayStub.calledOnceWithExactly({ fromBlock: 150, toBlock: 200 })).to.eql(true);
      expect(result.mismatchedBlocks).to.eql(1);
    });
  });

  describe('runOnce', function () {
    it('should process from/to in range batches when onlyMisingBlocks is false', async function () {
      const retrieveStub = sandbox.stub(retriever, 'retrieveAndProcessRange').resolves(0);
      const hasEventsStub = sandbox.stub(StarknetEventService, 'hasEventsForBlock');

      await retriever.runOnce({ fromBlock: 1, toBlock: 2500, onlyMisingBlocks: false });

      expect(hasEventsStub.called).to.eql(false);
      expect(retrieveStub.callCount).to.eql(4);
      expect(retrieveStub.getCall(0).calledWithExactly({ fromBlock: 1, toBlock: 1000 })).to.eql(true);
      expect(retrieveStub.getCall(1).calledWithExactly({ fromBlock: 1001, toBlock: 2000 })).to.eql(true);
      expect(retrieveStub.getCall(2).calledWithExactly({ fromBlock: 2001, toBlock: 2500 })).to.eql(true);
      expect(retrieveStub.getCall(3).calledWithExactly({ fromBlock: 'pre_confirmed', toBlock: 'pre_confirmed' }))
        .to.eql(true);
    });

    it('should keep per-block checks when onlyMisingBlocks is true', async function () {
      const retrieveStub = sandbox.stub(retriever, 'retrieveAndProcessRange').resolves(0);
      const hasEventsStub = sandbox.stub(StarknetEventService, 'hasEventsForBlock');
      hasEventsStub.withArgs(1).resolves(true);
      hasEventsStub.withArgs(2).resolves(false);
      hasEventsStub.withArgs(3).resolves(true);

      await retriever.runOnce({ fromBlock: 1, toBlock: 3, onlyMisingBlocks: true });

      expect(hasEventsStub.callCount).to.eql(3);
      expect(retrieveStub.callCount).to.eql(2);
      expect(retrieveStub.getCall(0).calledWithExactly({ fromBlock: 2, toBlock: 2 })).to.eql(true);
      expect(retrieveStub.getCall(1).calledWithExactly({ fromBlock: 'pre_confirmed', toBlock: 'pre_confirmed' }))
        .to.eql(true);
    });
  });

  describe('reconcileTrackedBlocks', function () {
    it('should prune old l1 tracked blocks even when they are outside reconciliation selection', async function () {
      const pruneStub = sandbox.stub(StarknetReconciliationBlockService, 'pruneAcceptedOnL1OlderThan').resolves();
      const getTrackedStub = sandbox.stub(StarknetReconciliationBlockService, 'getTrackedBlocks').resolves([]);
      const upsertStub = sandbox.stub(StarknetReconciliationBlockService, 'upsertMany').resolves();
      const deleteStub = sandbox.stub(StarknetReconciliationBlockService, 'deleteByBlockNumbers').resolves();
      const getBlockStub = sandbox.stub(retriever.provider, 'getBlock');

      const result = await retriever.reconcileTrackedBlocks({ headBlock: 5000 });

      expect(result.reorgStartBlock).to.eql(null);
      expect(result.checkedBlocks).to.eql(0);
      expect(pruneStub.calledOnceWithExactly(3000)).to.eql(true);
      expect(getTrackedStub.calledOnceWithExactly({
        headBlock: 5000,
        retentionBlocks: 2000,
        limit: 500
      })).to.eql(true);
      expect(getBlockStub.called).to.eql(false);
      expect(upsertStub.called).to.eql(false);
      expect(deleteStub.called).to.eql(false);
    });

    it('should detect reorg on tracked block hash mismatch', async function () {
      sandbox.stub(StarknetReconciliationBlockService, 'pruneAcceptedOnL1OlderThan').resolves();
      sandbox.stub(StarknetReconciliationBlockService, 'getTrackedBlocks').resolves([
        { blockNumber: 25, blockHash: '0xabc', status: 'ACCEPTED_ON_L2' }
      ]);
      const upsertStub = sandbox.stub(StarknetReconciliationBlockService, 'upsertMany').resolves();
      const deleteStub = sandbox.stub(StarknetReconciliationBlockService, 'deleteByBlockNumbers').resolves();
      sandbox.stub(retriever.provider, 'getBlock').resolves({ blockHash: '0xdef', status: 'ACCEPTED_ON_L2' });

      const result = await retriever.reconcileTrackedBlocks({ headBlock: 100 });

      expect(result.reorgStartBlock).to.eql(25);
      expect(upsertStub.called).to.eql(false);
      expect(deleteStub.called).to.eql(false);
    });

    it('should promote tracked l2 blocks to l1 on finalization', async function () {
      sandbox.stub(StarknetReconciliationBlockService, 'pruneAcceptedOnL1OlderThan').resolves();
      sandbox.stub(StarknetReconciliationBlockService, 'getTrackedBlocks').resolves([
        { blockNumber: 30, blockHash: '0xabc', status: 'ACCEPTED_ON_L2' }
      ]);
      const upsertStub = sandbox.stub(StarknetReconciliationBlockService, 'upsertMany').resolves();
      const deleteStub = sandbox.stub(StarknetReconciliationBlockService, 'deleteByBlockNumbers').resolves();
      sandbox.stub(retriever.provider, 'getBlock').resolves({ blockHash: '0xabc', status: 'ACCEPTED_ON_L1' });
      const promoteStub = sandbox.stub(StarknetEventService, 'updateBlockToL1Accepted').resolves();

      const result = await retriever.reconcileTrackedBlocks({ headBlock: 31 });

      expect(result.reorgStartBlock).to.eql(null);
      expect(promoteStub.calledOnceWithExactly(30)).to.eql(true);
      expect(upsertStub.calledOnceWithExactly([
        { blockNumber: 30, blockHash: '0xabc', status: 'ACCEPTED_ON_L1' }
      ])).to.eql(true);
      expect(deleteStub.called).to.eql(false);
    });
  });
});
