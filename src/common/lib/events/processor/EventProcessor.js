const { delay } = require('lodash');
const { Timer } = require('timer-node');
const { eachSeries } = require('async');
const StarknetProvider = require('@common/lib/starknet/provider');
const EventService = require('@common/services/Event');
const { EthereumBlockCache, StarknetBlockCache } = require('@common/lib/cache');
const web3 = require('@common/lib/web3');
const logger = require('@common/lib/logger');
const eventEmitter = require('@common/lib/sio/emitter');
const EventConfig = require('./config');

class EventProcessor {
  constructor(props = {}) {
    if (!props.runDelay) throw new Error('Missing required value for runDelay');
    this.runDelay = props.runDelay;
    this.starknetProvider = new StarknetProvider();
  }

  async process({ events }) {
    return eachSeries(events, async (event) => {
      const { address, event: eventName } = event;
      if (!address || !eventName) throw new Error('Missing required value for address or event');
      const EventHandlerClass = EventConfig.getHandlerByAddressAndEvent({ address, eventName });

      if (!EventHandlerClass) {
        logger.warn(`Missing handler for address: ${address} and event: ${eventName}`);
        return;
      }

      const handler = new EventHandlerClass(event);
      await handler.processEvent();
      await handler.finalizeEvent();
      await handler.emitSocketEvents();
    });
  }

  // get and cache the current on chain block number
  async processEthBlockNumber() {
    try {
      const blockNumber = await web3.eth.getBlockNumber();
      const cachedBlockNumber = await EthereumBlockCache.getCurrentBlockNumber();
      if (blockNumber && blockNumber !== cachedBlockNumber) {
        // update the cache (NOTE: this value is returned in /events header)
        await EthereumBlockCache.setCurrentBlockNumber(blockNumber);
      }
    } catch (error) {
      logger.warn('EventProcessor::processEthBlockNumber', error);
    }
  }

  // get and cache the current on chain block number
  async processStarknetBlockNumber() {
    try {
      const blockNumber = await this.starknetProvider.getBlockNumber();
      const cachedBlockNumber = await StarknetBlockCache.getCurrentBlockNumber();
      if (blockNumber && blockNumber !== cachedBlockNumber) {
        // update the cache (NOTE: this value is returned in /events header)
        await StarknetBlockCache.setCurrentBlockNumber(blockNumber);

        // emit eth block number event
        await eventEmitter.broadcast({
          type: 'CURRENT_STARKNET_BLOCK_NUMBER',
          body: {
            blockNumber,
            previous: cachedBlockNumber
          }
        });
      }
    } catch (error) {
      logger.warn(`EventProcessor::processStarknetBlockNumber: ${error.message}`);
    }
  }

  async main({ timeStamp } = {}) {
    const timer = new Timer({ label: 'EventProcessor-timer' }).start();
    const events = (timeStamp) ? await EventService.getFromTimestamp({ limit: 1000, timeStamp })
      : await EventService.getNonProcessed({ limit: 1000 });
    logger.info(`EventProcessor::main, event(s) to process: ${events.length}`);

    await this.process({ events });
    // await this.processEthBlockNumber();
    await this.processStarknetBlockNumber();

    // if time elapsed is greater than the run delay, run now, else delay the diff
    if (timer.ms() > this.runDelay) return this.main();
    const delayMs = this.runDelay - timer.ms();
    logger.info(`EventProcessor::main, run delay not met, delaying for [${delayMs}ms]...`);
    return new Promise(() => {
      delay(() => this.main(), delayMs);
    });
  }
}

module.exports = EventProcessor;
