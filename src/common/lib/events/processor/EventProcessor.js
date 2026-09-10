const { delay } = require('lodash');
const { Timer } = require('timer-node');
const { eachSeries } = require('async');
const EventService = require('@common/services/Event');
const { StarknetBlockCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');
const eventEmitter = require('@common/lib/sio/emitter');
const EventConfig = require('./config');

const DEFAULT_BATCH_SIZE = 100;

class EventProcessor {
  constructor(props = {}) {
    if (!props.runDelay) throw new Error('Missing required value for runDelay');
    this.runDelay = props.runDelay;
    this.onHealthy = props.onHealthy || (async () => {});
    this.batchSize = Number(props.batchSize || DEFAULT_BATCH_SIZE);
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

  async emitCachedStarknetBlockNumber() {
    const rawCurrentBlockNumber = await StarknetBlockCache.getCurrentBlockNumber();
    const currentBlockNumber = (rawCurrentBlockNumber === null || typeof rawCurrentBlockNumber === 'undefined')
      ? Number.NaN
      : Number(rawCurrentBlockNumber);
    const rawPrevious = await StarknetBlockCache.getLastEmittedCurrentBlockNumber();
    const previous = (rawPrevious === null || typeof rawPrevious === 'undefined') ? Number.NaN : Number(rawPrevious);

    if (!Number.isFinite(currentBlockNumber) || currentBlockNumber === previous) return false;

    const rawBlockTimestamp = await StarknetBlockCache.getCurrentBlockTimestamp();
    const blockTimestamp = (rawBlockTimestamp === null || typeof rawBlockTimestamp === 'undefined')
      ? Number.NaN
      : Number(rawBlockTimestamp);
    const body = {
      blockNumber: currentBlockNumber,
      previous: Number.isFinite(previous) ? previous : null
    };

    if (Number.isFinite(blockTimestamp)) {
      body.blockTimestamp = blockTimestamp;
    }

    await eventEmitter.broadcast({
      type: 'CURRENT_STARKNET_BLOCK_NUMBER',
      body
    });
    await StarknetBlockCache.setLastEmittedCurrentBlockNumber(currentBlockNumber);
    logger.debug(
      [
        'EventProcessor::emitCachedStarknetBlockNumber, emitted CURRENT_STARKNET_BLOCK_NUMBER',
        `blockNumber=${currentBlockNumber}`,
        `previous=${previous}`,
        ...(Number.isFinite(blockTimestamp) ? [`blockTimestamp=${blockTimestamp}`] : [])
      ].join(' ')
    );
    return true;
  }

  async emitCachedStarknetBlockNumberIfCaughtUp() {
    const remainingEvents = await EventService.getNonProcessed({ limit: 1 });
    if (remainingEvents.length > 0) return false;

    return this.emitCachedStarknetBlockNumber();
  }

  async scheduleNextRun({ timeStamp, timerMs, eventsLength }) {
    if (timerMs > this.runDelay || eventsLength >= this.batchSize) {
      return this.main({ timeStamp });
    }

    const delayMs = this.runDelay - timerMs;
    logger.info(`EventProcessor::main, run delay not met, delaying for [${delayMs}ms]...`);
    await new Promise((resolve) => {
      delay(resolve, delayMs);
    });
    return this.main({ timeStamp });
  }

  async main({ timeStamp } = {}) {
    const timer = new Timer({ label: 'EventProcessor-timer' }).start();
    const events = (timeStamp) ? await EventService.getFromTimestamp({ limit: this.batchSize, timeStamp })
      : await EventService.getNonProcessed({ limit: this.batchSize });
    logger.info(`EventProcessor::main, event(s) to process: ${events.length}`);

    await this.process({ events });
    if (typeof timeStamp === 'undefined' || timeStamp === null) {
      await this.emitCachedStarknetBlockNumberIfCaughtUp();
    }

    await this.onHealthy();
    return this.scheduleNextRun({ timeStamp, timerMs: timer.ms(), eventsLength: events.length });
  }
}

module.exports = EventProcessor;
