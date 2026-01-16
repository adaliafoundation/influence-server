const memoize = require('micro-memoize');
const mongoose = require('mongoose');
const web3 = require('@common/lib/web3');

const getBlock = async function (blockNumber) {
  const block = await web3.eth.getBlock(blockNumber);
  if (block && block.timestamp) return block;
  throw new Error('web3.eth.getBlock returned null');
};

// create a cached version of getBlock
// null or thrown errors will not get cached
const getBlockMemoized = memoize(getBlock, { isPromise: true, maxSize: 10 });

class EthereumEventService {
  static async updateOrCreateOne(ethEvent) {
    let { timestamp } = ethEvent;
    if (!timestamp) {
      const block = await getBlockMemoized(ethEvent.blockNumber);
      if (!(block || {}).timestamp) throw new Error(`Unable to get block for ${ethEvent.blockNumber}`);
      timestamp = block.timestamp;
    }
    return mongoose.model('Ethereum').findOneAndReplace(
      {
        blockHash: ethEvent.blockHash,
        transactionHash: ethEvent.transactionHash,
        logIndex: ethEvent.logIndex,
        event: ethEvent.event
      },
      {
        logIndex: ethEvent.logIndex,
        transactionIndex: ethEvent.transactionIndex,
        transactionHash: ethEvent.transactionHash,
        blockHash: ethEvent.blockHash,
        blockNumber: ethEvent.blockNumber,
        address: ethEvent.address,
        type: ethEvent.type,
        id: ethEvent.id,
        event: ethEvent.event,
        signature: ethEvent.signature,
        removed: ethEvent.removed,
        returnValues: ethEvent.returnValues,
        timestamp
      },
      {
        upsert: true,
        new: true
      }
    );
  }

  static async updateOrCreateMany(ethEvents) {
    // build bulkwrite actions
    const actions = await Promise.all(ethEvents.map(async (ethEvent) => {
      // getBlockMemoized will throw an error if error if getting block fails or return null
      const { timestamp } = await getBlockMemoized(ethEvent.blockNumber);
      const {
        address,
        blockHash,
        blockNumber,
        event,
        id,
        logIndex,
        removed,
        returnValues,
        signature,
        transactionIndex,
        transactionHash,
        type
      } = ethEvent;
      return {
        updateOne: {
          filter: {
            blockHash: ethEvent.blockHash,
            transactionHash: ethEvent.transactionHash,
            logIndex: ethEvent.logIndex,
            event: ethEvent.event,
            __t: 'Ethereum'
          },
          update: {
            address,
            blockHash,
            blockNumber,
            event,
            id,
            logIndex,
            removed,
            returnValues,
            signature,
            timestamp,
            transactionIndex,
            transactionHash,
            type
          },
          upsert: true
        }
      };
    }));

    // bulkwrite items
    return mongoose.model('Ethereum').bulkWrite(actions);
  }

  static getLatestEventByBlock() {
    return mongoose.model('Ethereum').findOne({}).sort({ blockNumber: -1 });
  }
}

module.exports = EthereumEventService;
