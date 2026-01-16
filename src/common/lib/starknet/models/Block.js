const { isObject, isString } = require('lodash');
const { hex } = require('../../num');
const TransactionReceipt = require('./TransactionReceipt');
const { PENDING_BLOCK_NUMBER } = require('./constants');

class Block {
  constructor(blockData) {
    this.blockData = blockData || {};
  }

  static isPendingBlockNumber(blockNumber) {
    if (!blockNumber) throw new Error('blockNumber is required');

    return (blockNumber.toString().toLowerCase() === 'pending') || blockNumber === PENDING_BLOCK_NUMBER;
  }

  // returns the blockNumber if available, if the block is in pending status,
  // return 'Number.MAX_SAFE_INTEGER' as the blockNumber
  get blockNumber() {
    return (this.blockData.block_number) ? Number(this.blockData.block_number) : PENDING_BLOCK_NUMBER;
  }

  // returns the blockHash if available, if the block is in pending status, return 'PENDING' as the hash
  get blockHash() {
    return this.blockData.block_hash || 'PENDING';
  }

  get status() {
    return this.blockData.status || 'PENDING';
  }

  get timestamp() {
    return Number(this.blockData.accepted_time) || Number(this.blockData.timestamp);
  }

  /**
   * Get the transactions.
   * Standardize the transaction hashes
   */
  get transactions() {
    return (this.blockData.transactions || []).map((transaction) => {
      if (isString(transaction)) return { transaction_hash: hex.to64(transaction) };
      if (isObject(transaction)) return { ...transaction, transaction_hash: hex.to64(transaction.transaction_hash) };
      throw new Error('Invalid transaction type');
    });
  }

  /**
   * Get the transactionReceipts.
   * Standardize the transaction hashes and add logIndex to the events
   */
  get transactionReceipts() {
    return (this.blockData.transaction_receipts || []).map((txReceipt) => (
      (txReceipt instanceof TransactionReceipt) ? txReceipt : new TransactionReceipt(txReceipt)
    ));
  }

  getTransactionIndex(transactionHash) {
    const txHash = hex.to64(transactionHash);
    const index = this.transactions.findIndex(({ transaction_hash: hash }) => hash === txHash);
    if (index < 0) throw new Error(`Transaction ${txHash} not found in block ${this.blockNumber}`);
    return index;
  }

  isAcceptedL1() {
    return this.blockData.status === 'ACCEPTED_ON_L1';
  }

  isAcceptedL2() {
    return this.blockData.status === 'ACCEPTED_ON_L2';
  }

  isAborted() {
    return this.blockData.status === 'ABORTED';
  }

  isPending() {
    return this.blockData.status === 'PENDING' || !this.blockData.status || !this.blockData.block_number;
  }
}

module.exports = Block;
