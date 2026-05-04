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

  static getLastAuditedFinalizedBlock() {
    return this.cacheInstance.get('LAST_AUDITED_FINALIZED_ETHEREUM_BLOCK');
  }

  static setLastAuditedFinalizedBlock(blockNumber) {
    return this.cacheInstance.set('LAST_AUDITED_FINALIZED_ETHEREUM_BLOCK', blockNumber);
  }

  static getFinalizedBlockNumber() {
    return this.cacheInstance.get('FINALIZED_ETHEREUM_BLOCK_NUMBER');
  }

  static setFinalizedBlockNumber(blockNumber) {
    return this.cacheInstance.set('FINALIZED_ETHEREUM_BLOCK_NUMBER', blockNumber);
  }

  static getFinalizedBlockTimestamp() {
    return this.cacheInstance.get('FINALIZED_ETHEREUM_BLOCK_TIMESTAMP');
  }

  static setFinalizedBlockTimestamp(timestamp) {
    return this.cacheInstance.set('FINALIZED_ETHEREUM_BLOCK_TIMESTAMP', timestamp);
  }
}

module.exports = EthereumBlockCache;
