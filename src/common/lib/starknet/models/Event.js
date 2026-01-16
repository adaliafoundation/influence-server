const { Address } = require('@influenceth/sdk');
const { isNil } = require('lodash');
const { hex } = require('../../num');
const { PENDING_BLOCK_NUMBER } = require('./constants');

class Event {
  constructor(eventData) {
    this._eventData = eventData;
  }

  get blockNumber() {
    return (this._eventData.block_number || PENDING_BLOCK_NUMBER);
  }

  get blockHash() {
    return this._eventData.block_hash || 'PENDING';
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
    return (isNil(this._eventData.logIndex)) ? null : this._eventData.logIndex;
  }

  get transactionHash() {
    return (this._eventData.transaction_hash) ? hex.to64(this._eventData.transaction_hash) : null;
  }

  isBlockPending() {
    return this.blockNumber === PENDING_BLOCK_NUMBER;
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
      transactionHash: this.transactionHash
    };
  }
}

module.exports = Event;
