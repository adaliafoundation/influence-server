const axios = require('axios');
const { compact } = require('lodash');
const { Address } = require('@influenceth/sdk');
const Block = require('../models/Block');
const DefaultStarknetProvider = require('./default');

class SequencerProvider extends DefaultStarknetProvider {
  get defaultBackoffOptions() {
    return { ...super.defaultBackoffOptions, startingDelay: 700 };
  }

  async _getBlock(blockNumber) {
    const url = `${this.endpoint}/feeder_gateway/get_block`;
    const response = await axios.get(url, { params: { blockNumber } }, { responseType: 'json' });
    if (response.data.code) throw new Error(`Error getting block: ${JSON.stringify(response.data)}`);
    return new Block(response.data);
  }

  async _getBlockNumber() {
    const url = `${this.endpoint}/feeder_gateway/get_block`;
    const response = await axios.get(url, { }, { responseType: 'json' });
    if (response.data.code) throw new Error(`Error getting block: ${JSON.stringify(response.data)}`);

    return Number(response.data.block_number);
  }

  async _getEvents({ address, fromBlock, toBlock }) {
    if (!address) throw new Error('address required');
    if (!fromBlock) throw new Error('fromBlock required');
    if (!toBlock) throw new Error('toBlock required');

    const events = [];
    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
      const block = await this._getBlock(Block.isPendingBlockNumber(blockNumber) ? 'pending' : blockNumber);
      const _events = block.transactionReceipts.reduce((acc, tr) => {
        tr.events.forEach((e) => {
          if (Address.areEqual(e.fromAddress, address, 'starknet', 'starknet')) {
            acc.push({
              address: e.fromAddress,
              blockHash: block.blockHash,
              blockNumber: block.blockNumber,
              data: e.data,
              keys: e.keys,
              logIndex: e.logIndex,
              status: block.status,
              timestamp: block.timestamp,
              transactionHash: tr.transactionHash,
              transactionIndex: tr.transactionIndex
            });
          }
        });
        return acc;
      }, []);
      events.push(..._events);
    }

    return events;
  }

  /*
    Public methods
  */
  async getBlock(blockNumber, { withBackOff = true } = {}) {
    return (withBackOff) ? this._callWithBackoff(() => this._getBlock(blockNumber), 'getBlock')
      : this._getBlock(blockNumber);
  }

  async getBlockNumber({ withBackOff = true } = {}) {
    return (withBackOff) ? this._callWithBackoff(() => this._getBlockNumber(), 'getBlockNumber')
      : this._getBlockNumber();
  }

  async getEvents({ address, addresses = [], fromBlock, toBlock = null }) {
    if (!address && (addresses || []).length === 0) throw new Error('address or addresses required');
    const _addresses = compact([address, ...addresses]).map((a) => Address.toStandard(a, 'starknet'));

    const events = [];
    for (const _address of _addresses) {
      const _events = await this._getEvents({ address: _address, fromBlock, toBlock });
      events.push(..._events);
    }
    return events;
  }
}

module.exports = SequencerProvider;
