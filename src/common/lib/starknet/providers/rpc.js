const { Address } = require('@influenceth/sdk');
const axios = require('axios');
const { chain, isString, isObject } = require('lodash');
const { StarknetRpcCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');
const Block = require('../models/Block');
const TransactionReceipt = require('../models/TransactionReceipt');
const Event = require('../models/Event');
const DefaultStarknetProvider = require('./default');

class RpcProvider extends DefaultStarknetProvider {
  _toBlockId(blockNumber) {
    if (isObject(blockNumber) && ('block_number' in blockNumber || 'block_hash' in blockNumber)) return blockNumber;
    if (isString(blockNumber) && !Number.isFinite(Number(blockNumber))) return blockNumber;
    if (Block.isPreConfirmedBlockNumber(blockNumber)) return 'pre_confirmed';
    return { block_number: blockNumber };
  }

  /*
    Internal methods
  */
  async _getBlock(blockNumber) {
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: { block_id: this._toBlockId(blockNumber) }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    return new Block(response.data.result);
  }

  async _getBlockWithTxHashes({ blockNumber, blockHash, cacheEnabled = false } = {}) {
    const hasBlockNumber = typeof blockNumber !== 'undefined' && blockNumber !== null;
    if (!hasBlockNumber && !blockHash) throw new Error('No block number or block hash provided');

    if (cacheEnabled && (blockHash || blockNumber)) {
      const cached = await StarknetRpcCache.getBlockWithTxHashes({ blockNumber, blockHash });
      if (cached) return new Block(cached);
    }

    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: { block_id: (blockHash) ? { block_hash: blockHash } : this._toBlockId(blockNumber) }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    const block = new Block(response.data.result);

    // Only cache if the block is not pre-confirmed
    if (cacheEnabled && !block.isPreConfirmed()) {
      await StarknetRpcCache.setBlockWithTxHashes({ blockHash, blockNumber, data: response.data.result });
    }

    return block;
  }

  async _getPreConfirmedBlock() {
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: { block_id: 'pre_confirmed' }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    return new Block(response.data.result);
  }

  async _getEvents({ address, chunkSize = 100, fromBlock, toBlock = null, continuationToken = null, acc = [] }) {
    if (!address) throw new Error('No address provided');

    const _fromBlock = this._toBlockId(fromBlock);
    const _toBlock = this._toBlockId(toBlock ?? fromBlock);

    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      id: 0,
      method: 'starknet_getEvents',
      params: {
        filter: {
          from_block: _fromBlock,
          to_block: _toBlock,
          address: Address.toStandard(address, 'starknet'),
          chunk_size: chunkSize,
          continuation_token: continuationToken
        }
      }
    }, { responseType: 'json' });

    if (response.data.error) throw new Error(`Error getting events: ${JSON.stringify(response.data.error)}`);

    if (response.data.result.continuation_token) {
      return this._getEvents({
        address,
        chunkSize,
        continuationToken: response.data.result.continuation_token,
        fromBlock,
        toBlock,
        acc: acc.concat(response.data.result.events)
      });
    }

    return [...acc, ...response.data.result.events].map((e) => new Event(e));
  }

  async _getEventsBatch({ addresses, chunkSize = 100, fromBlock, toBlock = null }) {
    if (addresses?.length === 0) throw new Error('No addresses provided');

    const _fromBlock = this._toBlockId(fromBlock);
    const _toBlock = this._toBlockId(toBlock ?? fromBlock);

    const events = [];
    const body = addresses.map((a, index) => ({
      jsonrpc: '2.0',
      method: 'starknet_getEvents',
      id: index,
      params: {
        filter: {
          from_block: _fromBlock,
          to_block: _toBlock,
          address: Address.toStandard(a, 'starknet'),
          chunk_size: chunkSize
        }
      }
    }));

    const response = await axios.post(this.endpoint, body, { responseType: 'json' });

    // error check
    const hasErrors = response.data.some((r) => r.error);
    if (hasErrors) throw new Error(`Error getting events: ${JSON.stringify(response.data.map((r) => r.error))}`);

    for (const { id, result } of response.data) {
      events.push(...result.events.map((e) => new Event(e)));

      // if there are more events, get them with _getEvents which will handle continuation tokens
      if (result.continuation_token) {
        const moreEvents = await this._getEvents({
          address: addresses[id],
          chunkSize,
          continuationToken: result.continuation_token,
          fromBlock,
          toBlock
        });
        events.push(...moreEvents);
      }
    }

    return events;
  }

  async _getBlockNumber() {
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_blockNumber',
      id: 0,
      params: {}
    }, { responseType: 'json' });

    if (response.data.error) throw new Error(`Error (get_block_number): ${JSON.stringify(response.data.error)}`);

    return Number(response.data.result);
  }

  async _getTransactionReceipt({ transactionHash, cacheEnabled = false }) {
    if (cacheEnabled) {
      const cached = await StarknetRpcCache.getTransactionReceipt(transactionHash);
      if (cached) return new TransactionReceipt(cached);
    }

    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      id: 0,
      method: 'starknet_getTransactionReceipt',
      params: { transaction_hash: transactionHash }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting transaction receipt: ${JSON.stringify(response.data.error)}`);
    }

    const txReceipt = new TransactionReceipt(response.data.result);

    // Only cache if the block is not pre-confirmed
    if (cacheEnabled && !txReceipt.isBlockPreConfirmed()) {
      await StarknetRpcCache.setTransactionReceipt(transactionHash, response.data.result);
    }

    return txReceipt;
  }

  async _getTransactionReceipts({ address, addresses, fromBlock, toBlock }) {
    const receipts = [];

    const method = (addresses?.length > 0) ? '_getEventsBatch' : '_getEvents';
    const events = await this[method]({
      address,
      addresses,
      fromBlock,
      toBlock,
      chunkSize: 100
    });
    if (events.length === 0) return [];

    // Get a unique list of transaction hashes
    const txHashes = chain(events).map('transactionHash').uniq().value();
    for (const transactionHash of txHashes) {
      receipts.push(await this._getTransactionReceipt({ transactionHash }));
    }

    return receipts;
  }

  /*
    Public methods
  */
  async getBlock(blockNumber, { withBackOff = true, withTransactionReceipts = false } = {}) {
    const block = (withBackOff) ? await this._callWithBackoff(() => this._getBlock(blockNumber), 'getBlock')
      : this._getBlock(blockNumber);

    if (withTransactionReceipts && block && block.transactions.length > 0) {
      block.transactionReceipts = await this.getTransactionReceipts(block.transactions);
    }

    return block;
  }

  async getBlockNumber({ withBackOff = true } = {}) {
    return (withBackOff) ? this._callWithBackoff(() => this._getBlockNumber(), 'getBlockNumber')
      : this._getBlockNumber();
  }

  async getEvents({ address, addresses = [], fromBlock, toBlock }, { withBackOff = true } = {}) {
    if (typeof fromBlock === 'undefined' || fromBlock === null) throw new Error('No fromBlock provided');
    const method = (addresses?.length > 0) ? '_getEventsBatch' : '_getEvents';
    const fetchRawEvents = () => this[method]({
      address,
      addresses,
      fromBlock,
      toBlock: toBlock || fromBlock,
      chunkSize: 100
    });
    const rawEvents = (withBackOff)
      ? await this._callWithBackoff(fetchRawEvents, 'getEvents')
      : await fetchRawEvents();
    if (rawEvents.length === 0) return [];

    const blocksByHash = {};
    const isPreConfirmedRange = (
      Block.isPreConfirmedBlockNumber(fromBlock) || Block.isPreConfirmedBlockNumber(toBlock || fromBlock)
    );
    const confirmedBlockHashes = chain(rawEvents)
      .filter((event) => !event.isBlockPreConfirmed() && event.blockHash)
      .map('blockHash')
      .uniq()
      .value();
    for (const blockHash of confirmedBlockHashes) {
      blocksByHash[blockHash] = await this._getBlockWithTxHashes({ blockHash, cacheEnabled: true });
    }

    let preConfirmedBlock = null;
    if (isPreConfirmedRange) {
      try {
        preConfirmedBlock = await this._getPreConfirmedBlock();
      } catch (error) {
        logger.warn(`RpcProvider::getEvents, unable to load pre_confirmed block metadata: ${error}`);
      }
    }

    const events = [];
    const transactionEventIndexMap = {};
    for (const event of rawEvents) {
      const block = event.isBlockPreConfirmed() ? preConfirmedBlock : blocksByHash[event.blockHash];

      if (!block && !event.isBlockPreConfirmed()) {
        throw new Error(`Block not found for event: ${JSON.stringify(event)}`);
      }
      if (!block && event.isBlockPreConfirmed()) {
        logger.debug(`Skipping pre-confirmed event missing block metadata: ${JSON.stringify(event)}`);
        continue; // eslint-disable-line no-continue
      }

      let { transactionIndex } = event;
      if (transactionIndex === null && event.transactionHash) {
        try {
          transactionIndex = block.getTransactionIndex(event.transactionHash);
        } catch (error) {
          if (event.isBlockPreConfirmed()) {
            logger.debug(`Pre-confirmed transaction ${event.transactionHash} not found on current block.`);
            continue; // eslint-disable-line no-continue
          }
          throw error;
        }
      }

      let { logIndex } = event;
      if (logIndex === null) {
        const txKey = event.transactionHash;
        logIndex = transactionEventIndexMap[txKey] || 0;
        transactionEventIndexMap[txKey] = logIndex + 1;
      }

      events.push({
        address: event.fromAddress,
        blockHash: block.blockHash,
        blockNumber: block.blockNumber,
        data: event.data,
        keys: event.keys,
        logIndex,
        status: block.status,
        timestamp: block.timestamp,
        transactionHash: event.transactionHash,
        transactionIndex
      });
    }

    return events;
  }

  async getTransactionReceipt(transactionHash, { withBackOff = true } = {}) {
    return (withBackOff) ? this._callWithBackoff(
      () => this._getTransactionReceipt({ transactionHash }),
      'getTransactionReceipt'
    ) : this._getTransactionReceipt({ transactionHash });
  }

  async getTransactionReceipts(transactions, options) {
    const receipts = [];
    for (const transaction of transactions) {
      let txHash;
      if (isString(transaction)) txHash = transaction;
      if (isObject(transaction)) txHash = transaction.transaction_hash;
      const receipt = await this.getTransactionReceipt(txHash, options);
      receipts.push(receipt);
    }

    return receipts;
  }
}

module.exports = RpcProvider;
