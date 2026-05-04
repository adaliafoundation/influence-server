const { Address } = require('@influenceth/sdk');
const { chain, castArray } = require('lodash');
const { hex } = require('../../num');
const Event = require('./Event');

class TransactionReceipt {
  constructor(transactionReceiptData) {
    this._transactionReceiptData = transactionReceiptData;
  }

  get blockNumber() {
    return (
      typeof this._transactionReceiptData.block_number !== 'undefined'
      && this._transactionReceiptData.block_number !== null
    )
      ? Number(this._transactionReceiptData.block_number)
      : null;
  }

  get blockHash() {
    return this._transactionReceiptData.block_hash || null;
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
