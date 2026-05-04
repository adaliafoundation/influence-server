const appConfig = require('config');
const { delay } = require('lodash');
const { Timer } = require('timer-node');
const logger = require('@common/lib/logger');
const { StarknetEventService } = require('@common/services');
const StarknetProvider = require('@common/lib/starknet/provider');
const { StarknetBlockCache } = require('@common/lib/cache');
const StarknetEventConfig = require('./config');

const DEFAULT_BLOCK_BATCH_SIZE = 1000;
const RUN_ONCE_BLOCK_BATCH_SIZE = DEFAULT_BLOCK_BATCH_SIZE;
const DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS = 25000;

class StarknetRetriever {
  constructor(props = {}) {
    const rpcEndpoint = appConfig.get('EventRetriever.starknet.rpcProvider');

    this.provider = new StarknetProvider({
      ...(rpcEndpoint ? { rpcEndpoint } : {}),
      ...props
    });
  }

  getTrackedAddresses() {
    return StarknetEventConfig.toArray().map(({ address }) => address);
  }

  async getBootstrapLastRetrievedBlock() {
    const originBlock = Number(appConfig.get('Starknet.originBlock'));
    const bootstrapLookbackBlocks = Number(
      appConfig.EventRetriever.starknet?.bootstrapLookbackBlocks || DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS
    );
    const lastAuditedFinalizedBlock = Number(await StarknetBlockCache.getLastAuditedFinalizedBlock());
    const latestEvent = await StarknetEventService.getLatestEventByBlock();
    const latestEventBlock = Number(latestEvent?.blockNumber);
    let recentHeadBlock = Number.NaN;

    try {
      const headBlock = Number(await this.provider.getBlockNumber());
      if (Number.isFinite(headBlock)) {
        recentHeadBlock = Math.max(originBlock - 1, headBlock - bootstrapLookbackBlocks);
      }
    } catch (error) {
      logger.warn(`StarknetRetriever::getBootstrapLastRetrievedBlock, unable to load head block: ${error.message}`);
    }

    const orderedCandidates = [
      ['lastAuditedFinalizedBlock', lastAuditedFinalizedBlock],
      ['recentHeadBlock', recentHeadBlock],
      ['latestEventBlock', latestEventBlock]
    ];
    const [source, bootstrapBlock = originBlock - 1] = orderedCandidates
      .find(([, value]) => Number.isFinite(value)) || [];

    return {
      bootstrapBlock,
      source,
      candidates: {
        lastAuditedFinalizedBlock,
        recentHeadBlock,
        latestEventBlock
      }
    };
  }

  async ensureBootstrapCheckpoint() {
    const existingValue = await StarknetBlockCache.getLastRetrievedBlock();
    const parsedValue = Number(existingValue);
    if (Number.isFinite(parsedValue)) return parsedValue;

    const { bootstrapBlock, source, candidates } = await this.getBootstrapLastRetrievedBlock();
    await StarknetBlockCache.setLastRetrievedBlock(bootstrapBlock);
    logger.info(
      `StarknetRetriever::ensureBootstrapCheckpoint, bootstrapped to block ${bootstrapBlock}`
      + ` via ${source || 'origin'}`
      + ` (audited=${candidates.lastAuditedFinalizedBlock}, recentHead=${candidates.recentHeadBlock},`
      + ` latestEvent=${candidates.latestEventBlock})`
    );
    return bootstrapBlock;
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
  }

  async runner({ runDelay } = {}) {
    const _runDelay = Number(
      runDelay || appConfig.EventRetriever.starknet?.runDelay || appConfig.EventRetriever.runDelay
    );
    if (!_runDelay) throw new Error('No run delay provided');

    const keepRunning = true;
    const originBlock = Number(appConfig.get('Starknet.originBlock'));
    const batchSize = Number(appConfig.EventRetriever.starknet?.blockBatchSize || DEFAULT_BLOCK_BATCH_SIZE);

    while (keepRunning) {
      const logSlug = 'StarknetRetriever::runner';
      const timer = new Timer({ label: 'StarknetRetriever-timer' }).start();
      let fromBlock = originBlock;
      let toBlock = 0;

      try {
        const lastRetrieved = await this.ensureBootstrapCheckpoint();
        fromBlock = Math.max(originBlock, lastRetrieved + 1);
        toBlock = await this.provider.getBlockNumber();
        if (Number(fromBlock) <= Number(toBlock)) {
          const batchToBlock = Math.min(Number(toBlock), fromBlock + batchSize - 1);
          logger.info(`${logSlug}, retrieve range [${fromBlock} -> ${batchToBlock}]`);
          await this.retrieveAndProcessRange({ fromBlock, toBlock: batchToBlock });
          await StarknetBlockCache.setLastRetrievedBlock(batchToBlock);
          logger.info(`${logSlug}, advanced checkpoint to block ${batchToBlock}`);
        } else {
          logger.debug(`${logSlug}, caught up at block ${toBlock}`);
        }
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
    const unhandledEvents = [];
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
        unhandledEvents.push(event);
      }
    });

    if (unhandledEvents.length > 0) {
      const unhandledGroups = unhandledEvents.reduce((acc, event) => {
        const selector = event.keys?.[0] || 'unknown';
        const address = event.address || 'unknown';
        const key = `${address}:${selector}`;
        if (!acc[key]) acc[key] = { address, count: 0, selector };
        acc[key].count += 1;
        return acc;
      }, {});

      logger.info(
        `StarknetRetriever::pullAndFormatEvents, skipped [${unhandledEvents.length}] unhandled event(s)`
        + ` on [${_fromBlock} -> ${_toBlock}] across [${Object.keys(unhandledGroups).length}] selector group(s)`
      );

      Object.values(unhandledGroups).forEach(({ address, count, selector }) => {
        logger.debug(
          'StarknetRetriever::pullAndFormatEvents, unhandled selector summary'
          + ` address=${address} selector=${selector} count=${count}`
        );
      });

      unhandledEvents.forEach((event) => {
        logger.debug(`Unable to find handler for event: ${JSON.stringify(event)}`);
      });
    }

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
