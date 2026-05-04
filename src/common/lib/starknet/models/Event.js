const { Address } = require('@influenceth/sdk');
const { isNil } = require('lodash');
const { hex } = require('../../num');
const { PRE_CONFIRMED_BLOCK_HASH, PRE_CONFIRMED_BLOCK_NUMBER } = require('./constants');

class Event {
  constructor(eventData) {
    this._eventData = eventData;
  }

  get blockNumber() {
    return (typeof this._eventData.block_number !== 'undefined' && this._eventData.block_number !== null)
      ? Number(this._eventData.block_number)
      : PRE_CONFIRMED_BLOCK_NUMBER;
  }

  get blockHash() {
    return this._eventData.block_hash || PRE_CONFIRMED_BLOCK_HASH;
  }

  get data() {
    return this._eventData.data || null;
  }

  get fromAddress() {
    return (this._eventData.from_address) ? Address.toStandard(this._eventData.from_address, 'starknet') : null;
  }

  get keys() {
    return this._eventData.keys || null;
  }

  get logIndex() {
    const index = isNil(this._eventData.logIndex) ? this._eventData.event_index : this._eventData.logIndex;
    return isNil(index) ? null : Number(index);
  }

  get transactionHash() {
    return (this._eventData.transaction_hash) ? hex.to64(this._eventData.transaction_hash) : null;
  }

  get transactionIndex() {
    const index = this._eventData.transaction_index;
    return isNil(index) ? null : Number(index);
  }

  isBlockPreConfirmed() {
    return this.blockNumber === PRE_CONFIRMED_BLOCK_NUMBER;
  }

  isBlockPending() {
    return this.isBlockPreConfirmed();
  }

  toString() {
    return JSON.stringify(this.toObject());
  }

  toObject() {
    return {
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      data: this.data,
      fromAddress: this.fromAddress,
      keys: this.keys,
      logIndex: this.logIndex,
      transactionHash: this.transactionHash,
      transactionIndex: this.transactionIndex
    };
  }
}

module.exports = Event;
