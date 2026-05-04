const appConfig = require('config');
const logger = require('@common/lib/logger');
const { StarknetBlockCache } = require('@common/lib/cache');
const { ActivityService, StarknetEventService } = require('@common/services');
const { StarknetRetriever } = require('../retrievers/starknet/retriever');
const BaseAuditor = require('./Base');

const DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS = 5000;

class StarknetAuditor extends BaseAuditor {
  constructor(props = {}) {
    super({
      name: 'StarknetAuditor'
    });

    this.batchSize = Number(props.batchSize || appConfig.EventAuditor?.starknet?.blockBatchSize || 1000);
    this.bootstrapLookbackBlocks = Number(
      props.bootstrapLookbackBlocks
      || appConfig.EventAuditor?.starknet?.bootstrapLookbackBlocks
      || DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS
    );
    this.originBlock = Number(appConfig.get('Starknet.originBlock'));
    this.retriever = props.retriever || new StarknetRetriever();
  }

  async getBootstrapCheckpoint(finalizedBlock) {
    const existingValue = await StarknetBlockCache.getLastAuditedFinalizedBlock();
    const parsedValue = Number(existingValue);
    if (Number.isFinite(parsedValue)) {
      return {
        checkpoint: parsedValue,
        bootstrapped: false
      };
    }

    const legacyAcceptedL1Block = Number(await StarknetBlockCache.getLegacyAcceptedL1Block());
    const lastRetrievedBlock = Number(await StarknetBlockCache.getLastRetrievedBlock());
    const latestStoredEvent = await StarknetEventService.getLatestEventByBlock();
    const latestStoredBlock = Number(latestStoredEvent?.blockNumber);
    const orderedHints = [
      ['legacyAcceptedL1Block', legacyAcceptedL1Block],
      ['lastRetrievedBlock', lastRetrievedBlock],
      ['latestStoredBlock', latestStoredBlock],
      ['finalizedBlock', finalizedBlock]
    ];
    const [source, hintBlock = finalizedBlock] = orderedHints.find(([, value]) => Number.isFinite(value)) || [];
    const boundedHint = Math.min(finalizedBlock, hintBlock);
    const checkpoint = Math.max(this.originBlock - 1, boundedHint - this.bootstrapLookbackBlocks);

    await StarknetBlockCache.setLastAuditedFinalizedBlock(checkpoint);
    logger.info(
      `StarknetAuditor::getBootstrapCheckpoint, bootstrapped to block ${checkpoint}`
      + ` via ${source || 'origin'}`
      + ` (legacyAccepted=${legacyAcceptedL1Block}, lastRetrieved=${lastRetrievedBlock},`
      + ` latestStored=${latestStoredBlock}, finalized=${finalizedBlock},`
      + ` lookback=${this.bootstrapLookbackBlocks})`
    );

    return {
      checkpoint,
      bootstrapped: true
    };
  }

  async getFinalizedFrontier() {
    const block = await this.retriever.provider.getBlock('l1_accepted');
    const finalizedBlock = Number(block?.blockNumber);
    return Number.isFinite(finalizedBlock) ? finalizedBlock : this.originBlock - 1;
  }

  async repairChangedBlocks(changedBlocks, chainEventsByBlock, storedEventsByBlock) {
    if (changedBlocks.length === 0) return;
    const transactionHashes = [...new Set(changedBlocks.flatMap((blockNumber) => (
      (storedEventsByBlock[blockNumber] || []).map(({ transactionHash }) => transactionHash)
    )))];
    logger.warn(
      `StarknetAuditor::repairChangedBlocks, repairing [${changedBlocks[0]}`
      + ` -> ${changedBlocks[changedBlocks.length - 1]}]`
      + ` and purging ${transactionHashes.length} transaction hash(es)`
    );

    await StarknetEventService.updateManyAsRemoved({
      blockNumber: { $in: changedBlocks },
      removed: { $ne: true }
    });

    await ActivityService.purgeByTransactionHashes(transactionHashes);

    const canonicalEvents = changedBlocks.flatMap((blockNumber) => chainEventsByBlock[blockNumber] || []);
    if (canonicalEvents.length > 0) await StarknetEventService.updateOrCreateMany(canonicalEvents);
    await StarknetEventService.resetLastProcessedFromBlock(Math.min(...changedBlocks));
  }

  async refreshMetadataBlocks(blocksToRefresh, chainEventsByBlock) {
    if (blocksToRefresh.length === 0) return;

    const canonicalEvents = blocksToRefresh.flatMap((blockNumber) => chainEventsByBlock[blockNumber] || []);
    if (canonicalEvents.length > 0) await StarknetEventService.updateOrCreateMany(canonicalEvents);
  }

  async auditOnce() {
    const logSlug = 'StarknetAuditor::auditOnce';
    const headBlock = Number(await this.retriever.provider.getBlockNumber());
    const finalizedBlock = await this.getFinalizedFrontier();
    const { checkpoint: lastAudited, bootstrapped } = await this.getBootstrapCheckpoint(finalizedBlock);
    const startBlock = Math.max(this.originBlock, lastAudited + 1);
    logger.info(
      `${logSlug}, finalized frontier head=${headBlock}, l1Accepted=${finalizedBlock}, start=${startBlock}`
    );

    if (startBlock > finalizedBlock) {
      if (bootstrapped && lastAudited !== finalizedBlock) {
        await StarknetBlockCache.setLastAuditedFinalizedBlock(finalizedBlock);
        logger.info(`StarknetAuditor::auditOnce, validated bootstrap checkpoint at block ${finalizedBlock}`);
      }
      logger.info(`${logSlug}, no finalized Starknet blocks pending audit`);
      return {
        headBlock,
        finalizedBlock,
        mismatchedBlocks: 0,
        startBlock,
        endBlock: finalizedBlock
      };
    }

    let mismatchedBlocks = 0;
    let refreshedBlocks = 0;
    await this.retriever.forEachBlockRangeBatch({
      fromBlock: startBlock,
      toBlock: finalizedBlock,
      batchSize: this.batchSize
    }, async ({ fromBlock, toBlock }) => {
      logger.info(`${logSlug}, auditing batch [${fromBlock} -> ${toBlock}]`);
      const chainEvents = await this.retriever.pullAndFormatEvents({ fromBlock, toBlock });
      const storedEvents = await StarknetEventService.getEventsByBlockRange(fromBlock, toBlock);
      const chainEventsByBlock = BaseAuditor.groupEventsByBlock(chainEvents);
      const storedEventsByBlock = BaseAuditor.groupEventsByBlock(storedEvents);
      const changedBlocks = [];
      const metadataBlocks = [];

      for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
        const blockChainEvents = chainEventsByBlock[blockNumber] || [];
        const blockStoredEvents = storedEventsByBlock[blockNumber] || [];
        const { identityChanged, metadataChanged } = BaseAuditor.compareBlockEvents({
          chainEvents: blockChainEvents,
          storedEvents: blockStoredEvents,
          metadataKeys: ['status', 'timestamp']
        });

        if (identityChanged) {
          changedBlocks.push(blockNumber);
        } else if (metadataChanged) {
          metadataBlocks.push(blockNumber);
        }
      }

      if (changedBlocks.length > 0) {
        logger.warn(`${logSlug}, repairing ${changedBlocks.length} mismatched block(s)`);
        await this.repairChangedBlocks(changedBlocks, chainEventsByBlock, storedEventsByBlock);
        mismatchedBlocks += changedBlocks.length;
      }

      if (metadataBlocks.length > 0) {
        await this.refreshMetadataBlocks(metadataBlocks, chainEventsByBlock);
        refreshedBlocks += metadataBlocks.length;
      }

      await StarknetBlockCache.setLastAuditedFinalizedBlock(toBlock);
      logger.info(`${logSlug}, advanced finalized audit checkpoint to block ${toBlock}`);
    });

    return {
      headBlock,
      finalizedBlock,
      mismatchedBlocks,
      refreshedBlocks,
      startBlock,
      endBlock: finalizedBlock
    };
  }
}

module.exports = StarknetAuditor;
