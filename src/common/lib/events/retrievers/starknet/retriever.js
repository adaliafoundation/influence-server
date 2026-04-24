const appConfig = require('config');
const { delay, groupBy } = require('lodash');
const { Timer } = require('timer-node');
const logger = require('@common/lib/logger');
const { ActivityService, StarknetEventService } = require('@common/services');
const StarknetProvider = require('@common/lib/starknet/provider');
const { StarknetBlockCache } = require('@common/lib/cache');
const StarknetEventConfig = require('./config');

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

    const chainEvents = await this.pullAndFormatEvents({ fromBlock: startBlock, toBlock: headBlock });
    const chainEventsByBlock = groupBy(chainEvents, 'blockNumber');
    const storedEvents = await StarknetEventService.getEventsByBlockRange(startBlock, headBlock);
    const storedEventsByBlock = groupBy(storedEvents, 'blockNumber');

    let mismatchedBlocks = 0;
    for (let blockNumber = startBlock; blockNumber <= headBlock; blockNumber += 1) {
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
        }

        if (blockChainEvents.length > 0) {
          await StarknetEventService.updateOrCreateMany(blockChainEvents);
        }
      }
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
      await this.auditOnce({ blockOffset });

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
      for (let b = _fromBlock; b <= _toBlock; b += 1) {
        if (onlyMisingBlocks) {
          const exists = await StarknetEventService.hasEventsForBlock(b);
          if (exists) {
            logger.info(`StarknetRetriever::runOnce, events found on [${b}], skipping`);
            continue; // eslint-disable-line no-continue
          }
        }
        await this.retrieveAndProcessRange({ fromBlock: b, toBlock: b });
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
    return events.length;
  }
}

module.exports = {
  StarknetRetriever
};
