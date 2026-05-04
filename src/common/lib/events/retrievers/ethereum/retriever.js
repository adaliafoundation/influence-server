const appConfig = require('config');
const { delay } = require('lodash');
const { Timer } = require('timer-node');
const { EthereumBlockCache } = require('@common/lib/cache');
const web3 = require('@common/lib/web3');
const EthereumEventService = require('../../../../services/Event/Ethereum');
const EthereumEventsConfig = require('./config');
const logger = require('../../../logger');

const ETH_ORIGIN_BLOCK = appConfig.get('Ethereum.originBlock');
const DEFAULT_BLOCK_BATCH_SIZE = 1000;
const DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS = 10000;

class EthereumRetriever {
  async getBootstrapLastRetrievedBlock() {
    const originBlock = Number(ETH_ORIGIN_BLOCK);
    const bootstrapLookbackBlocks = Number(
      appConfig.EventRetriever.ethereum?.bootstrapLookbackBlocks || DEFAULT_BOOTSTRAP_LOOKBACK_BLOCKS
    );
    const lastAuditedFinalizedBlock = Number(await EthereumBlockCache.getLastAuditedFinalizedBlock());
    const latestEvent = await EthereumEventService.getLatestEventByBlock();
    const latestEventBlock = Number(latestEvent?.blockNumber);
    let recentHeadBlock = Number.NaN;

    try {
      const headBlock = Number(await web3.eth.getBlockNumber());
      if (Number.isFinite(headBlock)) {
        recentHeadBlock = Math.max(originBlock - 1, headBlock - bootstrapLookbackBlocks);
      }
    } catch (error) {
      logger.warn(`EthereumRetriever::getBootstrapLastRetrievedBlock, unable to load head block: ${error.message}`);
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
    const existingValue = await EthereumBlockCache.getLastRetrievedBlock();
    const parsedValue = Number(existingValue);
    if (Number.isFinite(parsedValue)) return parsedValue;

    const { bootstrapBlock, source, candidates } = await this.getBootstrapLastRetrievedBlock();
    await EthereumBlockCache.setLastRetrievedBlock(bootstrapBlock);
    logger.info(
      `EthereumRetriever::ensureBootstrapCheckpoint, bootstrapped to block ${bootstrapBlock}`
      + ` via ${source || 'origin'}`
      + ` (audited=${candidates.lastAuditedFinalizedBlock}, recentHead=${candidates.recentHeadBlock},`
      + ` latestEvent=${candidates.latestEventBlock})`
    );
    return bootstrapBlock;
  }

  async cacheCurrentBlockNumber(blockNumber) {
    if (!Number.isFinite(blockNumber)) return;

    const cachedBlockNumber = await EthereumBlockCache.getCurrentBlockNumber();
    if (blockNumber !== Number(cachedBlockNumber)) {
      await EthereumBlockCache.setCurrentBlockNumber(blockNumber);
    }
  }

  async forEachBlockRangeBatch({ fromBlock, toBlock, batchSize = DEFAULT_BLOCK_BATCH_SIZE }, fn) {
    if (!fn || typeof fn !== 'function') throw new Error('fn callback is required');
    if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) throw new Error('fromBlock/toBlock must be numbers');
    if (!Number.isFinite(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive number');

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += batchSize) {
      const batchToBlock = Math.min(toBlock, blockNumber + batchSize - 1);
      await fn({ fromBlock: blockNumber, toBlock: batchToBlock });
    }
  }

  async pullEvents({ address, fromBlock, toBlock } = {}) {
    logger.debug(`EthereumRetriever::pullEvents, from: ${fromBlock} to: ${toBlock}`);
    if (!Number.isFinite(fromBlock) || fromBlock < 0) return [];

    const normalizedAddress = address ? EthereumEventsConfig.getConfigByAddress(address)?.address : null;
    const queryAddresses = normalizedAddress ? [normalizedAddress] : EthereumEventsConfig.getTrackedAddresses();
    const topics = normalizedAddress
      ? Object.keys(EthereumEventsConfig.getConfigByAddress(normalizedAddress)?.eventTopicMap || {})
      : EthereumEventsConfig.getTrackedTopics();

    if (queryAddresses.length === 0 || topics.length === 0) return [];

    const logs = await web3.eth.getPastLogs({
      address: queryAddresses,
      fromBlock,
      toBlock,
      topics: [topics]
    });

    return logs.reduce((events, log) => {
      const decodedEvent = EthereumEventsConfig.decodeRawLog(log);
      if (!decodedEvent) return events;

      const handler = EthereumEventsConfig.getHandler(decodedEvent);
      if (!handler) return events;

      if (handler.eventFilter?.DEPRECATED_AT && handler.eventFilter.DEPRECATED_AT <= decodedEvent.blockNumber) {
        return events;
      }

      if (!EthereumEventsConfig.matchesEventFilter(decodedEvent, handler.eventFilter)) return events;

      events.push(handler.parseEvent(decodedEvent));
      return events;
    }, []);
  }

  async saveEvents(events) {
    return EthereumEventService.updateOrCreateMany(events);
  }

  async runOnce({ blocks, contractAddress, fromBlock, toBlock }) {
    if (blocks) {
      for (const block of blocks.map(Number)) {
        const events = await this.pullEvents({ address: contractAddress, fromBlock: block, toBlock: block });
        logger.info(`EthereumRetriever:runOnce, event(s) pulled: ${events.length}`);
        if (events.length > 0) await this.saveEvents(events);
      }
    } else {
      const usesLatestHead = toBlock === 'latest' || typeof toBlock === 'undefined' || toBlock === null;
      const _fromBlock = Number(fromBlock || ETH_ORIGIN_BLOCK);
      const _toBlock = usesLatestHead
        ? Number(await web3.eth.getBlockNumber())
        : Number(toBlock);
      if (usesLatestHead) await this.cacheCurrentBlockNumber(_toBlock);
      if (_toBlock < _fromBlock) return null;
      const batchSize = Number(appConfig.EventRetriever.ethereum?.blockBatchSize || DEFAULT_BLOCK_BATCH_SIZE);
      await this.forEachBlockRangeBatch({ fromBlock: _fromBlock, toBlock: _toBlock, batchSize }, async (range) => {
        const events = await this.pullEvents({ address: contractAddress, ...range });
        logger.info(
          `EthereumRetriever:runOnce, [${range.fromBlock} -> ${range.toBlock}], event(s) pulled: ${events.length}`
        );
        if (events.length > 0) await this.saveEvents(events);
      });
    }

    return null;
  }

  async runner({ runDelay } = {}) {
    const _runDelay = Number(
      runDelay || appConfig.EventRetriever.ethereum?.runDelay || appConfig.EventRetriever.runDelay
    );
    if (!_runDelay) throw new Error('No run delay provided');

    const keepRunning = true;

    while (keepRunning) {
      const logSlug = 'EthereumRetriever::runner';
      const timer = new Timer({ label: 'EthereumRetriever-timer' }).start();
      let latestBlockNumber;
      let fromBlock;
      let toBlock;
      try {
        latestBlockNumber = Number(await web3.eth.getBlockNumber());
        if (!latestBlockNumber) throw new Error('getBlockNumber returned empty value');
        await this.cacheCurrentBlockNumber(latestBlockNumber);
        const batchSize = Number(appConfig.EventRetriever.ethereum?.blockBatchSize || DEFAULT_BLOCK_BATCH_SIZE);
        const lastRetrieved = await this.ensureBootstrapCheckpoint();
        fromBlock = Math.max(Number(ETH_ORIGIN_BLOCK), lastRetrieved + 1);
        toBlock = Math.min(latestBlockNumber, fromBlock + batchSize - 1);

        if (fromBlock > latestBlockNumber) {
          logger.debug(`${logSlug}, caught up at block ${latestBlockNumber}`);
        } else {
          logger.info(`${logSlug}, retrieve range [${fromBlock} -> ${toBlock}] (head=${latestBlockNumber})`);
          const events = await this.pullEvents({ fromBlock, toBlock });

          if (events.length > 0) {
            logger.info(`${logSlug}, event(s) pulled: ${events.length}`);
            await this.saveEvents(events);
          } else {
            logger.debug(`${logSlug}, event(s) pulled: ${events.length}`);
          }

          await EthereumBlockCache.setLastRetrievedBlock(toBlock);
          logger.info(`${logSlug}, advanced checkpoint to block ${toBlock}`);
        }
      } catch (error) {
        logger.error(`${logSlug}, runner iteration failed`);
        logger.error(error);
      }

      if (timer.ms() < _runDelay) {
        const shortDelay = appConfig.util.getEnv('NODE_ENV') === 'development' ? 1 : 1000;
        const caughtUp = !Number.isFinite(latestBlockNumber)
          || !Number.isFinite(fromBlock)
          || fromBlock > latestBlockNumber
          || (Number.isFinite(toBlock) && toBlock >= latestBlockNumber);
        const delayMs = caughtUp ? _runDelay - timer.ms() : shortDelay;

        logger.info(`${logSlug}, run delay not met, delaying for [${delayMs}ms]...`);
        await new Promise((resolve) => {
          delay(resolve, delayMs);
        });
      }
    }

    return null;
  }
}

module.exports = {
  EthereumRetriever
};
