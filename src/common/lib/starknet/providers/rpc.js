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
  /*
    Internal methods
  */
  async _getBlock(blockNumber) {
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: (blockNumber === 'pending') ? { block_id: 'pending' } : { block_id: { block_number: blockNumber } }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    return new Block(response.data.result);
  }

  async _getBlockWithTxHashes({ blockNumber, blockHash, cacheEnabled = false } = {}) {
    if (!blockNumber && !blockHash) throw new Error('No block number or block hash provided');

    if (cacheEnabled && (blockHash || blockNumber)) {
      const cached = await StarknetRpcCache.getBlockWithTxHashes({ blockNumber, blockHash });
      if (cached) return new Block(cached);
    }

    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: { block_id: (blockHash) ? { block_hash: blockHash } : { block_number: blockNumber } }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    const block = new Block(response.data.result);

    // Only cache if the block is not pending
    if (cacheEnabled && !block.isPending()) {
      await StarknetRpcCache.setBlockWithTxHashes({ blockHash, blockNumber, data: response.data.result });
    }

    return block;
  }

  async _getPendingBlock() {
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0',
      method: 'starknet_getBlockWithTxHashes',
      id: 0,
      params: { block_id: 'pending' }
    }, { responseType: 'json' });

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

    return new Block(response.data.result);
  }

  async _getEvents({ address, chunkSize = 100, fromBlock, toBlock = null, continuationToken = null, acc = [] }) {
    if (!address) throw new Error('No address provided');

    const _fromBlock = (Block.isPendingBlockNumber(fromBlock)) ? 'pending' : { block_number: fromBlock };
    const _toBlock = (Block.isPendingBlockNumber(toBlock)) ? 'pending' : { block_number: (toBlock || _fromBlock) };

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

    if (response.data.error) {
      throw new Error(`Error getting block: ${JSON.stringify(response.data.error)}`);
    }

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

    const _fromBlock = (Block.isPendingBlockNumber(fromBlock)) ? 'pending' : { block_number: fromBlock };
    const _toBlock = (Block.isPendingBlockNumber(toBlock)) ? 'pending' : { block_number: (toBlock || _fromBlock) };

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
    if (hasErrors) throw new Error(`Error getting block: ${JSON.stringify(response.data.map((r) => r.error))}`);

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

    // Only cache if the block is not pending
    if (cacheEnabled && !txReceipt.isBlockPending()) {
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

  async getEvents({ address, addresses = [], fromBlock, toBlock }) {
    const events = [];
    if (!fromBlock) throw new Error('No fromBlock provided');

    const pendingBlock = (Block.isPendingBlockNumber(fromBlock) || Block.isPendingBlockNumber(toBlock || fromBlock))
      ? await this._getPendingBlock() : null;

    // Get a unique list of transaction receipts for the given address(es) and block range
    const transactionReceipts = await this._getTransactionReceipts({
      address, addresses, fromBlock, toBlock: toBlock || fromBlock, isPending: !!pendingBlock });

    // For each transaction hash, get the transaction receipt, pull the relevant events
    for (const transactionReceipt of transactionReceipts) {
      const block = (transactionReceipt.isBlockPending()) ? pendingBlock
        : await this._getBlockWithTxHashes({ blockHash: transactionReceipt.blockHash });

      if (!block && transactionReceipt.isBlockPending()) {
        logger.debug(`Non-pending block not found for transactionReceipt: ${JSON.stringify(transactionReceipt)}`);
        continue; // eslint-disable-line no-continue
      }

      // if not a pending block transaction and no block found, throw an error
      // this will cause the block to be fetched again
      if (!block) throw new Error(`Block not found for transactionReceipt: ${JSON.stringify(transactionReceipt)}`);

      let transactionIndex;
      try {
        transactionIndex = block.getTransactionIndex(transactionReceipt.transactionHash);
      } catch (error) {
        // If we are in a pending block, the transaction may have been reverted, just skip it
        if (pendingBlock) {
          logger.debug(`Transaction ${transactionReceipt.transactionHash} not found on pending block.`);
          continue; // eslint-disable-line no-continue
        } else {
          throw error;
        }
      }

      // NOTE: this filtering may not be required
      const filteredEvents = transactionReceipt.getEventsByAddress([address, ...addresses]);

      filteredEvents.reduce((acc, e) => {
        acc.push({
          address: e.fromAddress,
          blockHash: block.blockHash,
          blockNumber: block.blockNumber,
          data: e.data,
          keys: e.keys,
          logIndex: e.logIndex,
          status: block.status,
          timestamp: block.timestamp,
          transactionHash: transactionReceipt.transactionHash,
          transactionIndex
        });
        return acc;
      }, events);
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
