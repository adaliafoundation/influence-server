const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');

class SwayCrossingService {
  static async decrementReady({ data, event }) {
    if (isNil(event?.transactionHash) || isNil(event?.logIndex)
      || isNil(event?.timestamp)) throw new Error('Missing transactionHash or logIndex');

    // first find any matching docs with amount and toAddress
    const doc = await mongoose.model('SwayCrossing').findOne({ toAddress: data.toAddress, amount: data.amount });
    if (!doc) {
      logger.warn('SwayCrossingService::decrement, No SwayCrossing document found for '
        + `toAddress: ${data.toAddress} with amount: ${data.amount}`);
      return null;
    }

    const _event = {
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      timestamp: event.timestamp
    };

    if (doc.hasEvent(_event)) return doc;
    doc.addEvent(_event);
    doc.decrementReadyCount();
    return doc.save();
  }

  static find({ fromAddress, toAddress } = {}) {
    const filter = { };
    if (fromAddress) filter.fromAddress = Address.toStandard(fromAddress);
    if (toAddress) filter.toAddress = Address.toStandard(toAddress);

    return mongoose.model('SwayCrossing').find(filter).lean();
  }

  static async incrementReady({ data, event } = {}) {
    if (isNil(event?.transactionHash) || isNil(event?.logIndex)
      || isNil(event?.timestamp)) throw new Error('Missing transactionHash or logIndex');

    const _event = {
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      timestamp: event.timestamp
    };

    // first find any matching docs with amount and toAddress
    const doc = await mongoose.model('SwayCrossing').findOne({ toAddress: data.toAddress, amount: data.amount });

    // if not found, create one
    if (!doc) {
      return mongoose.model('SwayCrossing').create({
        ...mongoose.model('SwayCrossing').hydrate(data).toJSON(),
        readyCount: 1,
        events: [_event]
      });
    }

    // if the event already exists, bail out now
    if (doc.hasEvent(_event)) return doc;

    // add event to events array
    doc.addEvent(_event);

    // increase the ready count
    doc.incrementReadyCount();

    // decrement the pending count
    doc.decrementPendingCount();

    return doc.save();
  }

  static async initialize({ data, event }) {
    if (isNil(event?.transactionHash) || isNil(event?.logIndex)
      || isNil(event?.timestamp)) throw new Error('Missing transactionHash or logIndex');

    // first find any matching docs with amount and toAddress
    const doc = await mongoose.model('SwayCrossing').findOne({ toAddress: data.toAddress, amount: data.amount });

    const _event = {
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      timestamp: event.timestamp
    };

    // if not found, create one
    if (!doc) {
      return mongoose.model('SwayCrossing').create({
        ...mongoose.model('SwayCrossing').hydrate(data).toJSON(),
        events: [_event],
        pendingCount: 1
      });
    }

    // if the event already exists, bail out now
    if (doc.hasEvent(_event)) return doc;

    // add the event
    doc.addEvent(_event);

    // increase the pending count
    doc.incrementPendingCount();

    return doc.save();
  }
}

module.exports = SwayCrossingService;
