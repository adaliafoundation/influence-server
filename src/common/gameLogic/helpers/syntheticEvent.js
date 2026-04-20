const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('@common/lib/logger');

const BLOCK_OFFSET = 9_000_000_000; // high offset to never collide with real blocks

// logCounter is per-action (reset on each create(), incremented by createComponentEvent()).
// Safe in-memory because component events are always written sequentially within one request.
let logCounter = 0;

class SyntheticEvent {
  /**
   * Atomically increment a shared counter via MongoDB. Safe across clustered workers.
   */
  static async _nextSeq(key) {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    return counter.seq;
  }

  /**
   * Look up the event key hash from the Dispatcher system handler's eventConfig.
   * This is the keccak256 of the event name, used by handler routing and
   * included in on-chain events.
   */
  static _getEventKeys(eventName) {
    try {
      // eslint-disable-next-line global-require
      const systemHandlers = require('@common/lib/events/handlers/starknet/Dispatcher/systems');
      const handler = systemHandlers[eventName];
      if (handler?.eventConfig?.keys) return handler.eventConfig.keys;
      logger.warn(`SyntheticEvent: no event keys found for handler "${eventName}"`);
    } catch (e) {
      logger.warn(`SyntheticEvent: failed to load handler for "${eventName}": ${e.message}`);
    }
    return [];
  }

  /**
   * Checks if an action with this idempotency key has already been executed.
   * Returns the existing synthetic event if found, null otherwise.
   */
  static async findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const StarknetEvent = mongoose.model('Starknet');
    return StarknetEvent.findOne({ 'returnValues.idempotencyKey': idempotencyKey }).lean();
  }

  /**
   * Creates and persists a real Starknet Event document in MongoDB.
   * The resulting doc has a valid _id, __t, timestamp, blockNumber,
   * transactionIndex, logIndex — everything ComponentService needs.
   *
   * @param {string} eventName - e.g. 'ConstructionPlanned'
   * @param {object} returnValues - the decoded event payload
   * @param {string} [transactionHash] - optional tx hash (auto-generated if omitted)
   * @param {object} [session] - MongoDB session for transactional writes
   * @param {string} [idempotencyKey] - client-provided key for crash-safe retries
   * @returns {Document} a saved Mongoose Event (Starknet discriminator) document
   */
  static async create({ eventName, returnValues, transactionHash, session, idempotencyKey }) {
    const StarknetEvent = mongoose.model('Starknet');

    const now = Math.floor(Date.now() / 1000);
    const blockSeq = await this._nextSeq('synthetic_block');
    const txSeq = await this._nextSeq('synthetic_tx');
    logCounter = 0; // reset log counter for each new "transaction"

    const event = new StarknetEvent({
      address: 'local-hybrid-server',
      blockHash: `0xlocal_block_${blockSeq}`,
      blockNumber: BLOCK_OFFSET + blockSeq,
      event: eventName,
      name: eventName,
      keys: this._getEventKeys(eventName),
      logIndex: 0,
      returnValues: {
        ...returnValues,
        ...(idempotencyKey && { idempotencyKey })
      },
      timestamp: now,
      transactionHash: transactionHash || this._generateTxHash(),
      transactionIndex: txSeq,
      status: 'ACCEPTED_ON_L2',
      lastProcessed: new Date() // mark as already processed so EventProcessor skips it
    });

    await event.save({ session });
    return event;
  }

  /**
   * Creates additional synthetic events for component updates within the same
   * "transaction" (same txHash, incrementing logIndex). This preserves ordering
   * guarantees when multiple components are written for one action.
   */
  static async createComponentEvent({ parentEvent, componentName, returnValues, session }) {
    const StarknetEvent = mongoose.model('Starknet');
    logCounter += 1;

    const event = new StarknetEvent({
      address: 'local-hybrid-server',
      blockHash: parentEvent.blockHash,
      blockNumber: parentEvent.blockNumber,
      event: `ComponentUpdated_${componentName}`,
      name: `ComponentUpdated_${componentName}`,
      logIndex: logCounter,
      returnValues,
      timestamp: parentEvent.timestamp,
      transactionHash: parentEvent.transactionHash,
      transactionIndex: parentEvent.transactionIndex,
      status: 'ACCEPTED_ON_L2',
      lastProcessed: new Date()
    });

    await event.save({ session });
    return event;
  }

  static _generateTxHash() {
    return `0x${crypto.randomBytes(31).toString('hex')}`;
  }
}

module.exports = SyntheticEvent;
