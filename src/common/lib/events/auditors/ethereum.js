const appConfig = require('config');
const logger = require('@common/lib/logger');
const { EthereumBlockCache } = require('@common/lib/cache');
const { ActivityService, EthereumEventService } = require('@common/services');
const web3 = require('@common/lib/web3');
const { EthereumRetriever } = require('../retrievers/ethereum/retriever');
const BaseAuditor = require('./Base');

class EthereumAuditor extends BaseAuditor {
  constructor(props = {}) {
    super({
      name: 'EthereumAuditor'
    });

    this.batchSize = Number(props.batchSize || appConfig.EventAuditor?.ethereum?.blockBatchSize || 1000);
    this.finalityBlocks = Number(props.finalityBlocks || appConfig.EventAuditor?.ethereum?.finalityBlocks || 10);
    this.originBlock = Number(appConfig.get('Ethereum.originBlock'));
    this.retriever = props.retriever || new EthereumRetriever();
  }

  async ensureBootstrapCheckpoint() {
    const existingValue = await EthereumBlockCache.getLastAuditedFinalizedBlock();
    const parsedValue = Number(existingValue);
    if (Number.isFinite(parsedValue)) return parsedValue;

    const retrieverCheckpoint = Number(await EthereumBlockCache.getLastRetrievedBlock());
    const latestStoredEvent = await EthereumEventService.getLatestEventByBlock();
    const latestStoredBlock = Number(latestStoredEvent?.blockNumber);
    const baseCheckpoint = [retrieverCheckpoint, latestStoredBlock]
      .filter(Number.isFinite)
      .reduce((maxValue, value) => Math.max(maxValue, value), this.originBlock - 1);
    const bootstrapBlock = Math.max(this.originBlock - 1, baseCheckpoint - this.finalityBlocks);

    await EthereumBlockCache.setLastAuditedFinalizedBlock(bootstrapBlock);
    logger.info(
      `EthereumAuditor::ensureBootstrapCheckpoint, bootstrapped to block ${bootstrapBlock}`
      + ` (retriever=${retrieverCheckpoint}, latestEvent=${latestStoredBlock}, finalityBlocks=${this.finalityBlocks})`
    );
    return bootstrapBlock;
  }

  async cacheFinalizedBlock(headBlock) {
    const finalizedBlock = Math.max(0, headBlock - this.finalityBlocks);
    const block = await web3.eth.getBlock(finalizedBlock);
    const timestamp = Number(block?.timestamp || 0);

    await EthereumBlockCache.setFinalizedBlockNumber(finalizedBlock);
    await EthereumBlockCache.setFinalizedBlockTimestamp(timestamp);

    return {
      finalizedBlock,
      finalizedTimestamp: timestamp
    };
  }

  async repairChangedBlocks(changedBlocks, chainEventsByBlock, storedEventsByBlock) {
    if (changedBlocks.length === 0) return;
    const transactionHashes = [...new Set(changedBlocks.flatMap((blockNumber) => (
      (storedEventsByBlock[blockNumber] || []).map(({ transactionHash }) => transactionHash)
    )))];
    logger.warn(
      `EthereumAuditor::repairChangedBlocks, repairing [${changedBlocks[0]}`
      + ` -> ${changedBlocks[changedBlocks.length - 1]}]`
      + ` and purging ${transactionHashes.length} transaction hash(es)`
    );

    await EthereumEventService.updateManyAsRemoved({
      blockNumber: { $in: changedBlocks },
      removed: { $ne: true }
    });

    await ActivityService.purgeByTransactionHashes(transactionHashes);

    const canonicalEvents = changedBlocks.flatMap((blockNumber) => chainEventsByBlock[blockNumber] || []);
    if (canonicalEvents.length > 0) await EthereumEventService.updateOrCreateMany(canonicalEvents);
    await EthereumEventService.resetLastProcessedFromBlock(Math.min(...changedBlocks));
  }

  async auditOnce() {
    const logSlug = 'EthereumAuditor::auditOnce';
    const headBlock = Number(await web3.eth.getBlockNumber());
    if (!Number.isFinite(headBlock)) throw new Error('Ethereum head block unavailable');

    const { finalizedBlock, finalizedTimestamp } = await this.cacheFinalizedBlock(headBlock);
    const lastAudited = await this.ensureBootstrapCheckpoint();
    const startBlock = Math.max(this.originBlock, lastAudited + 1);
    logger.info(
      `${logSlug}, finalized frontier head=${headBlock}, finalized=${finalizedBlock},`
      + ` start=${startBlock}, finalizedTimestamp=${finalizedTimestamp}`
    );

    if (startBlock > finalizedBlock) {
      logger.info(`${logSlug}, no finalized Ethereum blocks pending audit`);
      return {
        headBlock,
        finalizedBlock,
        finalizedTimestamp,
        mismatchedBlocks: 0,
        startBlock,
        endBlock: finalizedBlock
      };
    }

    let mismatchedBlocks = 0;
    await this.retriever.forEachBlockRangeBatch({
      fromBlock: startBlock,
      toBlock: finalizedBlock,
      batchSize: this.batchSize
    }, async ({ fromBlock, toBlock }) => {
      logger.info(`${logSlug}, auditing batch [${fromBlock} -> ${toBlock}]`);
      const chainEvents = await this.retriever.pullEvents({ fromBlock, toBlock });
      const storedEvents = await EthereumEventService.getEventsByBlockRange(fromBlock, toBlock);
      const chainEventsByBlock = BaseAuditor.groupEventsByBlock(chainEvents);
      const storedEventsByBlock = BaseAuditor.groupEventsByBlock(storedEvents);
      const changedBlocks = [];

      for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
        const blockChainEvents = chainEventsByBlock[blockNumber] || [];
        const blockStoredEvents = storedEventsByBlock[blockNumber] || [];
        const { identityChanged } = BaseAuditor.compareBlockEvents({
          chainEvents: blockChainEvents,
          storedEvents: blockStoredEvents
        });

        if (identityChanged) changedBlocks.push(blockNumber);
      }

      if (changedBlocks.length > 0) {
        logger.warn(`${logSlug}, repairing ${changedBlocks.length} mismatched block(s)`);
        await this.repairChangedBlocks(changedBlocks, chainEventsByBlock, storedEventsByBlock);
        mismatchedBlocks += changedBlocks.length;
      }

      await EthereumBlockCache.setLastAuditedFinalizedBlock(toBlock);
      logger.info(`${logSlug}, advanced finalized audit checkpoint to block ${toBlock}`);
    });

    return {
      headBlock,
      finalizedBlock,
      finalizedTimestamp,
      mismatchedBlocks,
      startBlock,
      endBlock: finalizedBlock
    };
  }
}

module.exports = EthereumAuditor;
