const mongoose = require('mongoose');
const { orderBy } = require('lodash');

class StarknetEventService {
  static async updateOrCreateMany(events) {
    let result = {};

    // order the events to ensure they are created order from oldest to newest
    const actions = orderBy(events, ['blockNumber', 'transactionIndex', 'logIndex'], ['asc', 'asc', 'asc'])
      .map((event) => {
        const data = {
          address: event.address,
          blockHash: event.blockHash,
          blockNumber: event.blockNumber,
          event: event.event,
          data: event.data,
          keys: event.keys,
          logIndex: event.logIndex,
          name: event.name,
          returnValues: event.returnValues,
          signature: event.signature,
          status: event.status,
          timestamp: event.timestamp,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          version: event.version
        };

        const filter = {
          event: event.event,
          logIndex: event.logIndex,
          transactionHash: event.transactionHash,
          removed: false
        };

        // Only create if blockHash 'PENDING' because we not not want to update (or upsert)
        // This action will potentially fail due to a unique index constraint but this is expected
        return (event.blockHash === 'PENDING') ? { insertOne: { filter, document: data } }
          : { updateOne: { filter, update: { ...data, lastProcessed: null }, upsert: true } };
      });

    try {
      const response = await mongoose.model('Starknet').bulkWrite(actions, { ordered: false });
      result = response.result || response;
    } catch (error) {
      result = error.result?.result;
      if (error.code !== 11000) throw error;
    }

    return result;
  }

  static updateManyToL1Accepted(blockNumber) {
    return mongoose.model('Starknet').updateMany(
      { status: 'ACCEPTED_ON_L2', blockNumber: { $lte: blockNumber } },
      { status: 'ACCEPTED_ON_L1' }
    );
  }

  static getLatestEventByBlock() {
    return mongoose.model('Starknet').findOne({ removed: { $ne: true } }).sort({ blockNumber: -1 });
  }

  static getLatestAcceptedOnL1() {
    return mongoose.model('Starknet').findOne({ status: 'ACCEPTED_ON_L1', removed: { $ne: true } })
      .sort({ blockNumber: -1 });
  }

  static hasEventsForBlock(blockNumber) {
    return mongoose.model('Starknet').exists({ blockNumber, removed: { $ne: true } });
  }

  static getEventCountByBlock(blockNumber) {
    return mongoose.model('Starknet').countDocuments({ blockNumber, removed: { $ne: true } });
  }

  /*
    Update event document(s) according to the specified filter.
    Set removed to true and lastProcessed to null to indicate to the event processor that those documents need to be
    re-processed.
  */
  static updateManyAsRemoved(filter) {
    return mongoose.model('Starknet').updateMany(filter, { removed: true, lastProcessed: null });
  }
}

module.exports = StarknetEventService;
