const BaseMongoCache = require('./Base');

class StarknetBlockCache extends BaseMongoCache {
  static reset() {
    const cache = this.cacheInstance;

    return Promise.all([
      cache.delete('ACCEPTED_L1_BLOCK'),
      cache.delete('ACCEPTED_L2_BLOCKS')
    ]);
  }

  /*
    Get the last accepted l1 block from cache
  */
  static getl1AcceptedBlock() {
    return this.cacheInstance.get('ACCEPTED_L1_BLOCK');
  }

  static setl1AcceptedBlock(blockNumber) {
    return this.cacheInstance.set('ACCEPTED_L1_BLOCK', blockNumber);
  }

  /*
    Get seen/processed blocks from cache
    Each item will contain the blockNumber and blockHash
    Example: { 1234: 0x123456848 }
  */
  static async getl2AcceptedBlocks() {
    const result = await this.cacheInstance.get('ACCEPTED_L2_BLOCKS');
    return result || {};
  }

  static setl2AcceptedBlocks(values) {
    return this.cacheInstance.set('ACCEPTED_L2_BLOCKS', values);
  }

  static setCurrentBlockNumber(blockNumber) {
    return this.cacheInstance.set('CURRENT_STARKNET_BLOCK_NUMBER', blockNumber);
  }

  static getCurrentBlockNumber() {
    return this.cacheInstance.get('CURRENT_STARKNET_BLOCK_NUMBER');
  }
}

module.exports = StarknetBlockCache;
