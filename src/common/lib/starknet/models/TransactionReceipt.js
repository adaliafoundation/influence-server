const { Address } = require('@influenceth/sdk');
const { chain, castArray } = require('lodash');
const { hex } = require('../../num');
const { PENDING_BLOCK_NUMBER } = require('./constants');
const Event = require('./Event');

class TransactionReceipt {
  constructor(transactionReceiptData) {
    this._transactionReceiptData = transactionReceiptData;
  }

  get blockNumber() {
    return (this._transactionReceiptData.block_number || PENDING_BLOCK_NUMBER);
  }

  get blockHash() {
    return this._transactionReceiptData.block_hash || 'PENDING';
  }

  get transactionHash() {
    return hex.to64(this._transactionReceiptData.transaction_hash);
  }

  get transactionIndex() {
    return this._transactionReceiptData.transaction_index;
  }

  get(attr) {
    return this._transactionReceiptData[attr];
  }

  isBlockPending() {
    return this.blockNumber === PENDING_BLOCK_NUMBER;
  }

  get events() {
    return this._transactionReceiptData.events.map((event, logIndex) => new Event({
      ...event, transaction_hash: this.transactionHash, logIndex
    }));
  }

  getEventsByAddress(address) {
    const _addresses = chain(castArray(address)).compact().map((a) => Address.toStandard(a, 'starknet')).value();
    return this.events.filter((e) => _addresses.includes(e.fromAddress));
  }
}

module.exports = TransactionReceipt;
