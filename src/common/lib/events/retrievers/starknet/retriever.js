const appConfig = require('config');
const { delay, omitBy } = require('lodash');
const { Timer } = require('timer-node');
const logger = require('@common/lib/logger');
const { ActivityService, StarknetEventService } = require('@common/services');
const StarknetProvider = require('@common/lib/starknet/provider');
const { StarknetBlockCache } = require('@common/lib/cache');
const StarknetEventConfig = require('./config');

class StarknetRetriever {
  constructor(props = {}) {
    this.provider = new StarknetProvider(props);
  }

  // The intention of this method is to run on a delay behind the current runner N number of blocks behind
  // the current block number with the intent to catch any missed events that were not available per the provider
  // when first retrieved. This method should be run in a separate process to avoid blocking/overlapping with the
  // main runner process.
  async auditRunner({ runDelay, blockOffset = 10 } = {}) {
    const _runDelay = Number(runDelay || appConfig.EventRetriever.starknet?.auditRunDelay);
    if (!_runDelay) throw new Error('No run delay provided');
    const logSlug = 'StarknetAuditRetriever::auditRunner';
    const keepRunning = true;

    while (keepRunning) {
      const timer = new Timer({ label: 'StarknetAuditRetriever-timer' }).start();
      // need to get the current head block in order to determine the starting block - offset
      const headBlock = await this.provider.getBlockNumber();
      const startBlock = headBlock - blockOffset;
      logger.info(`${logSlug}, headBlock -> starBlock: ${startBlock} -> ${headBlock}`);

      for (let blockNumber = startBlock; blockNumber < headBlock; blockNumber += 1) {
        const events = await this.pullAndFormatEvents({ blockNumber });

        // save event(s) if not currently found in the database
        logger.info(`${logSlug}, [${events.length}] event(s) on block ${blockNumber}`);
        if (events.length > 0) {
          const currentCount = await StarknetEventService.getEventCountByBlock(blockNumber);
          if (currentCount < events.length) {
            const diff = events.length - currentCount;
            logger.info(`${logSlug}, ${diff} missing event(s) found on block ${blockNumber}.`
              + ` Found: ${events.length} Current: ${currentCount}`);
            logger.info(`${logSlug}, updating/creating [${events.length}] event(s) on block ${blockNumber}`);
            await StarknetEventService.updateOrCreateMany(events);
          }
        }
      }

      if (timer.ms() < _runDelay) {
        const delayMs = _runDelay - timer.ms();
        logger.info(`${logSlug}, run delay not met, delaying for [${delayMs}ms]...`);
        await new Promise((resolve) => { delay(resolve, delayMs); });
      }
    }
  }

  async runOnce({ blocks, fromBlock, toBlock, useCache = false, onlyMisingBlocks = false } = {}) {
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
        const _block = await this.provider.getBlock(block);
        await this.processBlock(_block, { useCache });
      }
    } else {
      logger.info(`StarknetRetriever::runOnce, fromBlock -> toBlock: ${fromBlock} -> ${toBlock}`);
      for (let b = fromBlock; b <= toBlock; b += 1) {
        if (onlyMisingBlocks) {
          const exists = await StarknetEventService.hasEventsForBlock(b);
          if (exists) {
            logger.info(`StarknetRetriever::runOnce, events found on [${b}], skipping`);
            continue; // eslint-disable-line no-continue
          }
        }
        const block = await this.provider.getBlock(b);
        await this.processBlock(block, { useCache });
      }
    }
  }

  async runner({ runDelay } = {}) {
    const _runDelay = Number(
      runDelay || appConfig.EventRetriever.starknet?.runDelay || appConfig.EventRetriever.runDelay
    );
    if (!_runDelay) throw new Error('No run delay provided');

    const keepRunning = true;

    while (keepRunning) {
      const logSlug = 'StarknetRetriever::runner';
      const timer = new Timer({ label: 'StarknetRetriever-timer' }).start();
      let fromBlock = 0;
      let toBlock = 0;
      let lastL1CachedBlock;

      try {
        // Update L2 -> L1 blocks first
        lastL1CachedBlock = await this.updateCachedL2BlocksToL1();
        logger.info(`StarknetRetriever::runner, updated L2 -> L1 accepted until ${lastL1CachedBlock}`);

        // Find the most recent cached block that is synced with the chain, fallback to lastL1CachedBlock
        const l2CachedBlocks = await StarknetBlockCache.getl2AcceptedBlocks();
        const cachedBlockNumbers = Object.keys(l2CachedBlocks).sort((a, b) => Number(a) - Number(b)).map(Number);
        if (cachedBlockNumbers.length === 0) {
          // if the cached l2 blocks are empty, try the cached l1 block or get latest accepted on l1 block from storage
          fromBlock = lastL1CachedBlock || (await StarknetEventService.getLatestAcceptedOnL1())?.blockNumber;
        } else {
          fromBlock = await this.findLastSyncedBlock({ blockNumbers: cachedBlockNumbers, cachedBlocks: l2CachedBlocks })
            || lastL1CachedBlock;
        }

        // Run most recent synced to the end of the current chain
        toBlock = await this.provider.getBlockNumber();
        logger.info(`${logSlug}, latestSyncedBlock -> headBlock: ${fromBlock} -> ${toBlock}`);

        for (let b = Number(fromBlock); b <= Number(toBlock); b += 1) {
          await new Promise((resolve) => { delay(resolve, 1000); });
          // An error thrown in retrieveAndProcess won't be caught and will break the loop
          await this.retrieveAndProcessBlock(b);
        }

        // retrieve and process the pending block
        await this.retrieveAndProcessBlock('pending');
      } catch (error) {
        logger.error(`${logSlug}, runner failed processing from block ${lastL1CachedBlock} to block ${toBlock}`);
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

  async getLastL1CachedBlock() {
    // Adjust down by one from origin block since the first one won't necessarily be accepted on l1 (on local)
    return (await StarknetBlockCache.getl1AcceptedBlock()) || appConfig.get('Starknet.originBlock') - 1;
  }

  /**
   * @description Pulls events from the provider and formats them for storage
   *
   * @param {BockInstance} block
   * @returns {Array{Object}}
   */
  async pullAndFormatEvents({ blockNumber }) {
    const events = [];
    const rawEvents = await this.provider.getEvents({
      addresses: StarknetEventConfig.toArray().map(({ address }) => address),
      fromBlock: blockNumber,
      toBlock: blockNumber
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

  async findLastSyncedBlock({ blockNumbers, cachedBlocks }) {
    // If there are no blocks in cache just return 0 to start from the beginning
    if (blockNumbers.length === 0) return 0;

    const half = Math.floor(blockNumbers.length / 2);
    const checkBlockNumber = blockNumbers[half];

    // There's only one element in the array so return the last block to start from
    if (half === 0) return checkBlockNumber;

    const block = await this.provider.getBlock(checkBlockNumber);

    // If the block hashes are not equal start running at the previous known synced block
    if (block.blockHash !== cachedBlocks[checkBlockNumber]) return blockNumbers[0];

    // Otherwise recurse until the end
    return this.findLastSyncedBlock({ blockNumbers: blockNumbers.slice(half), cachedBlocks });
  }

  /**
   * @description Handles an aborted block
   *
   * @param {Object} block
   */
  async handleAbortedBlock(block) {
    let l2CachedBlocks = await StarknetBlockCache.getl2AcceptedBlocks();
    const blockNumbersToPurge = Object.keys(l2CachedBlocks).filter((blockNumber) => (blockNumber >= block.blockNumber));
    await StarknetEventService.updateManyAsRemoved({ blockNumber: { $in: blockNumbersToPurge } });

    // Purge activity item(s) that have been marked removed
    await ActivityService.purgeByRemoved();

    // update l2 Accepted cached block(s)
    l2CachedBlocks = omitBy(l2CachedBlocks, (_, blockNumber) => (blockNumbersToPurge.includes(blockNumber)));
    await StarknetBlockCache.setl2AcceptedBlocks(l2CachedBlocks);
  }

  /**
   * @description Processes a block
   *
   * @param {Object} block
   * @param {Object} options
   */
  async processBlock(block, options = {}) {
    const { useCache = true } = options;
    const logSlug = 'StarknetRetriever::processBlock';
    // get the processed cached blocks
    const l2CachedBlocks = await StarknetBlockCache.getl2AcceptedBlocks();

    // check cache
    const l2CachedBlockHash = l2CachedBlocks[block.blockNumber];

    if (l2CachedBlockHash && useCache) {
      if (l2CachedBlockHash !== block.blockHash) {
        // handle aborted block
        logger.warn(`${logSlug}, handling aborted block [${block.blockNumber}] with hash [${block.blockHash}]`);
        await this.handleAbortedBlock(block);

        // break out of loop now. The next run will pull down the new blocks
        throw new Error('Aborted block detected');
      }
      if (l2CachedBlockHash === block.blockHash && block.isAcceptedL1()) {
        await StarknetBlockCache.setl1AcceptedBlock(block.blockNumber);

        // Remove all l2 cached block number(s) up to and incuding the current block number
        // This block is ACCEPTED on l1, we are assuming the previous block as as well
        await StarknetBlockCache.setl2AcceptedBlocks(omitBy(l2CachedBlocks, (__, cachedBlockNumber) => (
          cachedBlockNumber <= block.blockNumber
        )));

        // Update starknet event(s) prior to and including `block.blockNumber` and status accepted on l2
        // to accepted on l1
        await StarknetEventService.updateManyToL1Accepted(block.blockNumber);
        logger.debug(`${logSlug}, block [${block.blockNumber}] status updated to l1Accepted`);
      } else if (l2CachedBlockHash === block.blockHash && block.isAcceptedL2()) {
        logger.debug(`${logSlug}, block [${block.blockNumber}] status still l2Accepted, skipping`);
      }
    } else {
      const events = await this.pullAndFormatEvents(block);

      // save event(s)
      const formattedBlockNumber = (block.blockNumber === Number.MAX_SAFE_INTEGER) ? 'PENDING' : block.blockNumber;
      logger.info(`${logSlug}, [${events.length}] event(s) on block ${formattedBlockNumber}`);
      if (events.length > 0) await StarknetEventService.updateOrCreateMany(events);

      if (block.isAcceptedL1() && useCache) {
        await StarknetBlockCache.setl1AcceptedBlock(block.blockNumber);
      } else if (block.isAcceptedL2() && useCache) {
        await StarknetBlockCache.setl2AcceptedBlocks({ ...l2CachedBlocks, [block.blockNumber]: block.blockHash });
      }
    }
  }

  async retrieveAndProcessBlock(blockNumber) {
    const logSlug = 'StarknetRetriever::retrieveAndProcessBlock';
    let block;

    try {
      block = await this.provider.getBlock(blockNumber);
    } catch (error) {
      logger.error(`${logSlug}, getBlock failed: ${blockNumber}`);
      throw error;
    }

    // if the PENDING block was requested but the returned block is ACCPETED_ON_L2,
    // we can return now. It will get picked up and processed on the next run
    if (blockNumber === 'pending' && block.isAcceptedL2()) return;

    try {
      await this.processBlock(block);
    } catch (error) {
      logger.error(`${logSlug}, processBlock failed: [block: ${blockNumber}] ${JSON.stringify(block, null, 2)}`);
      throw error;
    }
  }

  /**
   * @description Processes from the oldest block in L2 accepted cache
   * until the oldest / first L2 accepted block on chain
   *
   * @param {Number} previousLastL1CachedBlock
   * @returns {Number} The last L1 cached block number
   */
  async updateCachedL2BlocksToL1(previousLastL1CachedBlock) {
    const l2CachedBlocks = await StarknetBlockCache.getl2AcceptedBlocks();

    // Adjust down by one from origin block since the first one won't necessarily be accepted on l1 (on local)
    const currentLastL1CachedBlock = await this.getLastL1CachedBlock();

    if (Object.values(l2CachedBlocks).length === 0 || previousLastL1CachedBlock === currentLastL1CachedBlock) {
      return currentLastL1CachedBlock;
    }

    await this.retrieveAndProcessBlock(currentLastL1CachedBlock + 1);
    return this.updateCachedL2BlocksToL1(currentLastL1CachedBlock);
  }
}

module.exports = {
  StarknetRetriever
};
