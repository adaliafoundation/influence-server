const appConfig = require('config');
const { compact, delay } = require('lodash');
const { Timer } = require('timer-node');
const { EthereumBlockCache } = require('@common/lib/cache');
const web3 = require('@common/lib/web3');
const EthereumEventService = require('../../../../services/Event/Ethereum');
const EthereumEventsConfig = require('./config');
const logger = require('../../../logger');

const BLOCK_WINDOW_OFFSET = 6;
const ETH_ORIGIN_BLOCK = appConfig.get('Ethereum.originBlock');

class EthereumRetriever {
  async getLatestLocalBlockNumber() {
    const event = await EthereumEventService.getLatestEventByBlock();
    return (event || {}).blockNumber;
  }

  async pullEvents({ address, fromBlock, toBlock } = {}) {
    logger.debug(`EthereumRetriever::pullEvents, from: ${fromBlock} to: ${toBlock}`);
    if (!fromBlock || fromBlock < 0) return [];
    const results = [];

    const configs = (address) ? compact([EthereumEventsConfig.getConfigByAddress(address)])
      : EthereumEventsConfig.toArray();

    if (configs.length === 0) throw new Error('No configs found for address(es) provided');

    for (const config of configs) {
      for (const handler of Object.values(config.handlers)) {
        const { eventFilter = {}, eventName } = handler;
        // If the to block is greater than the optional deprecation block, dont pull events
        if (!handler.eventFilter?.DEPRECATED_AT || handler.eventFilter?.DEPRECATED_AT > toBlock) {
          const events = await config.contract.getPastEvents(eventName, { fromBlock, toBlock, filter: eventFilter });
          results.push(...events.map((e) => handler.parseEvent(e)));
        }
      }
    }

    return results;
  }

  async saveEvents(events) {
    return EthereumEventService.updateOrCreateMany(events);
  }

  async saveEvent(event) {
    return EthereumEventService.updateOrCreateOne(event);
  }

  async initListeners() {
    const handleEvent = async (event, handler) => {
      const _event = handler.parseEvent(event);
      const { eventFilter } = handler;

      try {
        if (!eventFilter?.DEPRECATED_AT
          || (_event.blockNumber && _event.blockNumber < eventFilter?.DEPRECATED_AT)) {
          await this.saveEvent(_event);
        }
      } catch (saveError) {
        logger.error(saveError);
      }
    };

    const currentEthBlockNumber = await EthereumBlockCache.getCurrentBlockNumber()
      || await web3.eth.getBlockNumber();

    for (const { address, contract, handlers } of EthereumEventsConfig.toArray()) {
      for (const handler of Object.values(handlers)) {
        let options = {};
        const { eventFilter, eventName } = handler;

        // add event filter if it exists
        if (eventFilter) options = { filter: eventFilter };
        if (!eventFilter?.DEPRECATED_AT
          || (currentEthBlockNumber && eventFilter?.DEPRECATED_AT > currentEthBlockNumber)) {
          // add event subscription for the current event

          logger.info(`EthereumRetriever::initListeners, setting up listener for contract ${address}::${eventName}`);
          const subscription = await contract.events[eventName](options);
          subscription.on('data', (event) => handleEvent(event, handler));
          subscription.on('error', (error) => logger.error(error));
        }
      }
    }
  }

  async runOnce({ blocks, contractAddress, fromBlock, toBlock }) {
    if (blocks) {
      for (const block of blocks.map(Number)) {
        const events = await this.pullEvents({ address: contractAddress, fromBlock: block, toBlock: block });
        logger.info(`EthereumRetriever:runOnce, event(s) pulled: ${events.length}`);
        if (events.length > 0) await this.saveEvents(events);
      }
    } else {
      if (toBlock < fromBlock) return null;
      const events = await this.pullEvents({ address: contractAddress, fromBlock, toBlock });
      logger.info(`EthereumRetriever:runOnce, event(s) pulled: ${events.length}`);
      if (events.length > 0) await this.saveEvents(events);
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
      try {
        latestBlockNumber = Number(await web3.eth.getBlockNumber());
        if (!latestBlockNumber) throw new Error('getBlockNumber returned empty value');
      } catch (error) {
        logger.error(error);
        return null;
      }

      const lastRetrieved = (await EthereumBlockCache.getLastRetrievedBlock()) || ETH_ORIGIN_BLOCK;
      const lastLocalEvent = (await this.getLatestLocalBlockNumber()) || ETH_ORIGIN_BLOCK;
      const localStartBlock = Math.max(Number(lastRetrieved), Number(lastLocalEvent));
      const latestAvailableBlock = latestBlockNumber - BLOCK_WINDOW_OFFSET;
      const fromBlock = Math.min(localStartBlock, latestAvailableBlock);
      const toBlock = Math.min(latestAvailableBlock, fromBlock + BLOCK_WINDOW_OFFSET);

      try {
        const events = await this.pullEvents({ fromBlock, toBlock });

        if (events.length > 0) {
          logger.info(`${logSlug}, event(s) pulled: ${events.length}`);
          await this.saveEvents(events);
        } else {
          logger.debug(`${logSlug}, event(s) pulled: ${events.length}`);
        }

        await EthereumBlockCache.setLastRetrievedBlock(toBlock);
      } catch (error) {
        logger.error(error);
      }

      if (timer.ms() < _runDelay) {
        const shortDelay = appConfig.util.getEnv('NODE_ENV') === 'development' ? 1 : 1000;
        const delayMs = toBlock < latestAvailableBlock ? shortDelay : _runDelay - timer.ms();

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
