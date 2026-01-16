const BaseMongoCache = require('./Base');

class StarknetRpcCache extends BaseMongoCache {
  static transactionReceiptTtl = 60 * 60 * 1000; // 1 hour (in ms)

  static blockTtl = 60 * 60 * 1000; // 1 hour (in ms)

  static getPendingTransactionReceipt(transactionHash) {
    return this.cacheInstance.get(`STARKNET_PENDING_TRANSACTION_RECEIPT_${transactionHash}`);
  }

  static setPendingTransactionReceipt(transactionHash, data, ttl) {
    return this.cacheInstance.set(
      `STARKNET_PENDING_TRANSACTION_RECEIPT_${transactionHash}`,
      data,
      (ttl || this.transactionReceiptTtl)
    );
  }

  static getTransactionReceipt(transactionHash) {
    return this.cacheInstance.get(`STARKNET_TRANSACTION_RECEIPT_${transactionHash}`);
  }

  static setTransactionReceipt(transactionHash, data, ttl) {
    return this.cacheInstance.set(
      `STARKNET_TRANSACTION_RECEIPT_${transactionHash}`,
      data,
      (ttl || this.transactionReceiptTtl)
    );
  }

  static getBlockWithTxHashes({ blockHash, blockNumber }) {
    return this.cacheInstance.get(`STARKNET_BLOCK_W_TXHASHES_${(blockHash || blockNumber.toString())}`);
  }

  static setBlockWithTxHashes({ blockHash, blockNumber, data, ttl }) {
    const key = `STARKNET_BLOCK_W_TXHASHES_${(blockHash || blockNumber.toString())}`;
    return this.cacheInstance.set(key, data, (ttl || this.blockTtl));
  }
}

module.exports = StarknetRpcCache;
