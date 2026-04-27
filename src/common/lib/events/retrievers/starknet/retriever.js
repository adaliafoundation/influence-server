const appConfig = require('config');
const { delay, groupBy } = require('lodash');
const { Timer } = require('timer-node');
const logger = require('@common/lib/logger');
const {
  ActivityService,
  StarknetEventService,
  StarknetReconciliationBlockService
} = require('@common/services');
const StarknetProvider = require('@common/lib/starknet/provider');
const { StarknetBlockCache } = require('@common/lib/cache');
const { PRE_CONFIRMED_BLOCK_NUMBER } = require('@common/lib/starknet/models/constants');
const StarknetEventConfig = require('./config');

const DEFAULT_BLOCK_BATCH_SIZE = 1000;
const RUN_ONCE_BLOCK_BATCH_SIZE = DEFAULT_BLOCK_BATCH_SIZE;
const AUDIT_BLOCK_BATCH_SIZE = DEFAULT_BLOCK_BATCH_SIZE;
const AUDIT_UNRESOLVED_BLOCK_BATCH_SIZE = 500;
const AUDIT_L1_RETENTION_BLOCKS = 2000;

class StarknetRetriever {
  constructor(props = {}) {
    const rpcEndpoint = appConfig.get('EventRetriever.starknet.rpcProvider');

    this.provider = new StarknetProvider({
      ...(rpcEndpoint ? { rpcEndpoint } : {}),
      ...props
    });
  }

  static getEventFingerprint(event) {
    return [
      event.event,
      event.transactionHash,
      event.logIndex,
      event.blockHash
    ].join(':');
  }

  getTrackedAddresses() {
    return StarknetEventConfig.toArray().map(({ address }) => address);
  }

  hasBlockEventsChanged({ chainEvents = [], storedEvents = [] }) {
    if (chainEvents.length !== storedEvents.length) return true;

    const chainSet = new Set(chainEvents.map(StarknetRetriever.getEventFingerprint));
    for (const fingerprint of storedEvents.map(StarknetRetriever.getEventFingerprint)) {
      if (!chainSet.has(fingerprint)) return true;
    }

    return false;
  }

  // The intention of this method is to run on a delay behind the current runner N number of blocks behind
  // the current block number with the intent to catch any missed events that were not available per the provider
  // when first retrieved. This method should be run in a separate process to avoid blocking/overlapping with the
  // main runner process.
  async auditOnce({ blockOffset = 10 } = {}) {
    const logSlug = 'StarknetAuditRetriever::auditOnce';
    const originBlock = Number(appConfig.get('Starknet.originBlock'));
    const parsedBlockOffset = Number(blockOffset);
    if (!Number.isFinite(parsedBlockOffset) || parsedBlockOffset < 0) {
      throw new Error(`Invalid blockOffset: ${blockOffset}`);
    }

    // need to get the current head block in order to determine the starting block - offset
    const headBlock = Number(await this.provider.getBlockNumber());
    const startBlock = Math.max(originBlock, headBlock - parsedBlockOffset);
    logger.info(`${logSlug}, headBlock -> startBlock: ${startBlock} -> ${headBlock}`);

    let mismatchedBlocks = 0;
    await this.forEachBlockRangeBatch({
      fromBlock: startBlock,
      toBlock: headBlock,
      batchSize: AUDIT_BLOCK_BATCH_SIZE
    }, async ({ fromBlock: batchFromBlock, toBlock: batchToBlock }) => {
      logger.info(`${logSlug}, auditing batch [${batchFromBlock} -> ${batchToBlock}]`);
      const chainEvents = await this.pullAndFormatEvents({ fromBlock: batchFromBlock, toBlock: batchToBlock });
      const chainEventsByBlock = groupBy(chainEvents, 'blockNumber');
      const storedEvents = await StarknetEventService.getEventsByBlockRange(batchFromBlock, batchToBlock);
      const storedEventsByBlock = groupBy(storedEvents, 'blockNumber');

      for (let blockNumber = batchFromBlock; blockNumber <= batchToBlock; blockNumber += 1) {
        const blockChainEvents = chainEventsByBlock[blockNumber] || [];
        const blockStoredEvents = storedEventsByBlock[blockNumber] || [];
        logger.info(
          `${logSlug}, block [${blockNumber}], chain: ${blockChainEvents.length}, stored: ${blockStoredEvents.length}`
        );

        if (this.hasBlockEventsChanged({ chainEvents: blockChainEvents, storedEvents: blockStoredEvents })) {
          mismatchedBlocks += 1;
          logger.warn(`${logSlug}, mismatch detected on block [${blockNumber}], reconciling`);

          if (blockStoredEvents.length > 0) {
            await StarknetEventService.updateManyAsRemoved({ blockNumber });
            await ActivityService.purgeByRemoved();
            await this.removeReconciliationBlocks([blockNumber]);
          }

          if (blockChainEvents.length > 0) {
            await StarknetEventService.updateOrCreateMany(blockChainEvents);
            await this.syncReconciliationBlocks(blockChainEvents);
          }
        }
      }
    });

    const unresolvedResult = await this.reconcileTrackedBlocks({ headBlock });
    if (unresolvedResult.reorgStartBlock !== null) {
      logger.warn(`${logSlug}, reorg detected starting at block [${unresolvedResult.reorgStartBlock}]`);
      await this.replayRangeFromBlock({
        fromBlock: unresolvedResult.reorgStartBlock,
        toBlock: headBlock
      });
      mismatchedBlocks += 1;
    }

    return { headBlock, mismatchedBlocks, startBlock };
  }

  async auditRunner({ runDelay, blockOffset = 10 } = {}) {
    const _runDelay = Number(runDelay || appConfig.EventRetriever.starknet?.auditRunDelay);
    if (!_runDelay) throw new Error('No run delay provided');
    const keepRunning = true;

    while (keepRunning) {
      const timer = new Timer({ label: 'StarknetAuditRetriever-timer' }).start();
      const logSlug = 'StarknetAuditRetriever::auditRunner';
      try {
        await this.auditOnce({ blockOffset });
      } catch (error) {
        logger.error(`${logSlug}, runner iteration failed`);
        logger.error(error);
      }

      if (timer.ms() < _runDelay) {
        const delayMs = _runDelay - timer.ms();
        logger.info(`${logSlug}, run delay not met, delaying for [${delayMs}ms]...`);
        await new Promise((resolve) => { delay(resolve, delayMs); });
      }
    }
  }

  async runOnce({ blocks, fromBlock, toBlock, onlyMisingBlocks = false } = {}) {
    if (blocks) {
      logger.info(`StarknetRetriever::runOnce, blocks: ${blocks}`);
      for (const block of blocks.map(Number)) {
        if (onlyMisingBlocks) {
          const exists = await StarknetEventService.hasEventsForBlock(block);
          if (exists) {
            logger.info(`StarknetRetriever::runOnce, events found on [${block}], skipping`);
            continue; // eslint-disable-line no-continue
          }
        }
        await this.retrieveAndProcessRange({ fromBlock: block, toBlock: block });
      }
    } else {
      const _fromBlock = Number(fromBlock || appConfig.get('Starknet.originBlock'));
      const _toBlock = (toBlock === 'latest' || typeof toBlock === 'undefined' || toBlock === null)
        ? await this.provider.getBlockNumber()
        : Number(toBlock);

      logger.info(`StarknetRetriever::runOnce, fromBlock -> toBlock: ${_fromBlock} -> ${_toBlock}`);
      if (onlyMisingBlocks) {
        for (let b = _fromBlock; b <= _toBlock; b += 1) {
          const exists = await StarknetEventService.hasEventsForBlock(b);
          if (exists) {
            logger.info(`StarknetRetriever::runOnce, events found on [${b}], skipping`);
            continue; // eslint-disable-line no-continue
          }
          await this.retrieveAndProcessRange({ fromBlock: b, toBlock: b });
        }
      } else {
        await this.forEachBlockRangeBatch({
          fromBlock: _fromBlock,
          toBlock: _toBlock,
          batchSize: RUN_ONCE_BLOCK_BATCH_SIZE
        }, ({ fromBlock: batchFromBlock, toBlock: batchToBlock }) => (
          this.retrieveAndProcessRange({ fromBlock: batchFromBlock, toBlock: batchToBlock })
        ));
      }
    }

    await this.retrieveAndProcessRange({ fromBlock: 'pre_confirmed', toBlock: 'pre_confirmed' });
  }

  async runner({ runDelay } = {}) {
    const _runDelay = Number(
      runDelay || appConfig.EventRetriever.starknet?.runDelay || appConfig.EventRetriever.runDelay
    );
    if (!_runDelay) throw new Error('No run delay provided');

    const keepRunning = true;
    const originBlock = Number(appConfig.get('Starknet.originBlock'));
    const reconciliationLookback = Number(appConfig.EventRetriever.starknet?.reconciliationLookback || 50);

    while (keepRunning) {
      const logSlug = 'StarknetRetriever::runner';
      const timer = new Timer({ label: 'StarknetRetriever-timer' }).start();
      let fromBlock = originBlock;
      let toBlock = 0;

      try {
        const latestConfirmedEvent = await StarknetEventService.getLatestConfirmedEventByBlock();
        const lastSyncedBlock = Number(await StarknetBlockCache.getl1AcceptedBlock() || originBlock);
        const baseBlock = Math.max(
          Number(latestConfirmedEvent?.blockNumber || originBlock),
          lastSyncedBlock
        );
        fromBlock = Math.max(originBlock, baseBlock - reconciliationLookback);
        toBlock = await this.provider.getBlockNumber();
        logger.info(`${logSlug}, retrieve range [${fromBlock} -> ${toBlock}]`);
        if (Number(fromBlock) <= Number(toBlock)) {
          await this.retrieveAndProcessRange({ fromBlock, toBlock });
          await StarknetBlockCache.setl1AcceptedBlock(toBlock);
        }

        // Always pull PRE_CONFIRMED in each pass to keep recent events fresh.
        await this.retrieveAndProcessRange({ fromBlock: 'pre_confirmed', toBlock: 'pre_confirmed' });
      } catch (error) {
        logger.error(`${logSlug}, runner failed processing from block ${fromBlock} to block ${toBlock}`);
        logger.error(error);
      }

      if (timer.ms() < _runDelay) {
        const delayMs = _runDelay - timer.ms();
        logger.info(`${logSlug}, run delay not met, delaying for [${delayMs}ms]...`);
        await new Promise((resolve) => {
          delay(resolve, delayMs);
        });
      }
    }
  }

  // Internal

  async forEachBlockRangeBatch({ fromBlock, toBlock, batchSize = DEFAULT_BLOCK_BATCH_SIZE }, fn) {
    if (!fn || typeof fn !== 'function') throw new Error('fn callback is required');
    if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) throw new Error('fromBlock/toBlock must be numbers');
    if (!Number.isFinite(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive number');

    for (let b = fromBlock; b <= toBlock; b += batchSize) {
      const batchToBlock = Math.min(toBlock, b + batchSize - 1);
      await fn({ fromBlock: b, toBlock: batchToBlock });
    }
  }

  /**
   * @description Pulls events from the provider and formats them for storage
   *
   * @param {Number|String} fromBlock
   * @param {Number|String} toBlock
   * @returns {Array{Object}}
   */
  async pullAndFormatEvents({ blockNumber, fromBlock, toBlock } = {}) {
    const _fromBlock = (typeof blockNumber === 'undefined') ? fromBlock : blockNumber;
    const _toBlock = (typeof blockNumber === 'undefined') ? (toBlock || _fromBlock) : blockNumber;
    if (typeof _fromBlock === 'undefined') throw new Error('Missing required fromBlock value');

    const events = [];
    const rawEvents = await this.provider.getEvents({
      addresses: this.getTrackedAddresses(),
      fromBlock: _fromBlock,
      toBlock: _toBlock
    });
    rawEvents.forEach((event) => {
      const handler = StarknetEventConfig.getHandler(event);
      if (handler) {
        // if the handler is configured to ignore the event, skip it
        if (!handler.ignore) events.push(handler.parseEvent(event));
      } else {
        logger.warn(`Unable to find handler for event: ${JSON.stringify(event)}`);
      }
    });

    return events;
  }

  async retrieveAndProcessRange({ fromBlock, toBlock }) {
    const logSlug = 'StarknetRetriever::retrieveAndProcessRange';
    const events = await this.pullAndFormatEvents({ fromBlock, toBlock });

    if (events.length === 0) {
      logger.info(`${logSlug}, no events found for [${fromBlock} -> ${toBlock}]`);
      return 0;
    }

    logger.info(`${logSlug}, [${events.length}] event(s) on [${fromBlock} -> ${toBlock}]`);
    await StarknetEventService.updateOrCreateMany(events);
    await this.syncReconciliationBlocks(events);
    return events.length;
  }

  async syncReconciliationBlocks(events = []) {
    if (!Array.isArray(events) || events.length === 0) return;

    const blocks = [];
    events.forEach((event) => {
      const blockNumber = Number(event.blockNumber);
      if (!Number.isFinite(blockNumber) || blockNumber === PRE_CONFIRMED_BLOCK_NUMBER) return;

      blocks.push({
        blockNumber,
        blockHash: event.blockHash,
        status: event.status
      });
    });

    await StarknetReconciliationBlockService.upsertMany(blocks);
  }

  async removeReconciliationBlocks(blockNumbers = []) {
    if (!Array.isArray(blockNumbers) || blockNumbers.length === 0) return;
    await StarknetReconciliationBlockService.deleteByBlockNumbers(blockNumbers);
  }

  async reconcileTrackedBlocks({ headBlock }) {
    const retentionBlocks = Number(
      appConfig.EventRetriever.starknet?.auditL1RetentionBlocks || AUDIT_L1_RETENTION_BLOCKS
    );
    const batchSize = Number(
      appConfig.EventRetriever.starknet?.auditUnresolvedBlockBatchSize || AUDIT_UNRESOLVED_BLOCK_BATCH_SIZE
    );

    const minRetainedL1Block = headBlock - retentionBlocks;
    await StarknetReconciliationBlockService.pruneAcceptedOnL1OlderThan(minRetainedL1Block);
    const trackedBlocks = await StarknetReconciliationBlockService.getTrackedBlocks({
      headBlock,
      retentionBlocks,
      limit: batchSize
    });

    const upserts = [];
    const deletions = [];
    let reorgStartBlock = null;
    for (const tracked of trackedBlocks) {
      const blockNumber = Number(tracked.blockNumber);
      const chainBlock = await this.provider.getBlock(blockNumber);
      const hashMismatch = chainBlock.blockHash !== tracked.blockHash;
      const statusRegressed = tracked.status === 'ACCEPTED_ON_L1' && chainBlock.status !== 'ACCEPTED_ON_L1';

      if (hashMismatch || statusRegressed) {
        reorgStartBlock = blockNumber;
        break;
      }

      if (chainBlock.status === 'ACCEPTED_ON_L1') {
        if (tracked.status !== 'ACCEPTED_ON_L1') await StarknetEventService.updateBlockToL1Accepted(blockNumber);
        if ((headBlock - blockNumber) > retentionBlocks) {
          deletions.push(blockNumber);
        } else {
          upserts.push({
            blockNumber,
            blockHash: chainBlock.blockHash,
            status: 'ACCEPTED_ON_L1'
          });
        }
      } else {
        upserts.push({
          blockNumber,
          blockHash: chainBlock.blockHash,
          status: chainBlock.status
        });
      }
    }

    if (upserts.length > 0) await StarknetReconciliationBlockService.upsertMany(upserts);
    if (deletions.length > 0) await StarknetReconciliationBlockService.deleteByBlockNumbers(deletions);

    return {
      checkedBlocks: trackedBlocks.length,
      reorgStartBlock
    };
  }

  async replayRangeFromBlock({ fromBlock, toBlock }) {
    if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock) || fromBlock > toBlock) {
      throw new Error(`Invalid replay range [${fromBlock} -> ${toBlock}]`);
    }

    await StarknetReconciliationBlockService.deleteFromBlock(fromBlock);

    await StarknetEventService.updateManyAsRemoved({
      blockNumber: { $gte: fromBlock, $lte: toBlock },
      removed: { $ne: true }
    });
    await ActivityService.purgeByRemoved();
    await this.retrieveAndProcessRange({ fromBlock, toBlock });
  }
}

module.exports = {
  StarknetRetriever
};
