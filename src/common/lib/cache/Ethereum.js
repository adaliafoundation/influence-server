const BaseMongoCache = require('./Base');

class EthereumBlockCache extends BaseMongoCache {
  static getCurrentBlockNumber() {
    return this.cacheInstance.get('CURRENT_ETH_BLOCK_NUMBER');
  }

  static setCurrentBlockNumber(blockNumber) {
    return this.cacheInstance.set('CURRENT_ETH_BLOCK_NUMBER', blockNumber);
  }

  static getLastRetrievedBlock() {
    return this.cacheInstance.get('LAST_PROCESSED_ETHEREUM_BLOCK');
  }

  static setLastRetrievedBlock(blockNumber) {
    return this.cacheInstance.set('LAST_PROCESSED_ETHEREUM_BLOCK', blockNumber);
  }
}

module.exports = EthereumBlockCache;
