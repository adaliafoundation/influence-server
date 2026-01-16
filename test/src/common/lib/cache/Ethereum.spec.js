const { expect } = require('chai');
const mongoose = require('mongoose');
const BaseMongoCache = require('@common/lib/cache/Base');
const EthereumBlockCache = require('@common/lib/cache/Ethereum');

describe('LotDataCache', function () {
  let collection;

  beforeEach(function () {
    collection = mongoose.connection.collection('keyv');
  });

  afterEach(async function () {
    await collection.deleteMany({});
  });

  describe('getCurrentBlockNumber', function () {
    it('should get the current eth block number', async function () {
      await BaseMongoCache.cacheInstance.set('CURRENT_ETH_BLOCK_NUMBER', 42);
      expect(await EthereumBlockCache.getCurrentBlockNumber()).to.equal(42);
    });
  });

  describe('setCurrentBlockNumber', function () {
    it('should set the current eth block number', async function () {
      await EthereumBlockCache.setCurrentBlockNumber(42);
      expect(await BaseMongoCache.cacheInstance.get('CURRENT_ETH_BLOCK_NUMBER')).to.equal(42);
    });
  });

  describe('getLastRetrievedBlock', function () {
    it('should get the last retrieved eth block number', async function () {
      await BaseMongoCache.cacheInstance.set('LAST_PROCESSED_ETHEREUM_BLOCK', 42);
      expect(await EthereumBlockCache.getLastRetrievedBlock()).to.equal(42);
    });
  });

  describe('setLastRetrievedBlock', function () {
    it('should set the last retrieved eth block number', async function () {
      await EthereumBlockCache.setLastRetrievedBlock(42);
      expect(await BaseMongoCache.cacheInstance.get('LAST_PROCESSED_ETHEREUM_BLOCK')).to.equal(42);
    });
  });
});
