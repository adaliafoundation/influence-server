const { expect } = require('chai');
const mongoose = require('mongoose');
const BaseMongoCache = require('@common/lib/cache/Base');
const StarknetBlockCache = require('@common/lib/cache/Starknet');

describe('StarknetBlockCache', function () {
  let collection;

  beforeEach(function () {
    collection = mongoose.connection.collection('keyv');
  });

  afterEach(async function () {
    await collection.deleteMany({});
  });

  describe('cacheInstance (getter)', function () {
    it('should return a keyv instance ', function () {
      expect(StarknetBlockCache.cacheInstance).to.be.an('object');
    });
  });

  describe('getCurrentBlockNumber', function () {
    it('should get the current starknet block number', async function () {
      await BaseMongoCache.cacheInstance.set('CURRENT_STARKNET_BLOCK_NUMBER', 42);
      expect(await StarknetBlockCache.getCurrentBlockNumber()).to.equal(42);
    });
  });

  describe('setCurrentBlockNumber', function () {
    it('should set the current starknet block number', async function () {
      await StarknetBlockCache.setCurrentBlockNumber(42);
      expect(await BaseMongoCache.cacheInstance.get('CURRENT_STARKNET_BLOCK_NUMBER')).to.equal(42);
    });
  });

  describe('getLastRetrievedBlock', function () {
    it('should get the last retrieved starknet block number', async function () {
      await BaseMongoCache.cacheInstance.set('LAST_RETRIEVED_STARKNET_BLOCK', 42);
      expect(await StarknetBlockCache.getLastRetrievedBlock()).to.equal(42);
    });
  });

  describe('setLastRetrievedBlock', function () {
    it('should set the last retrieved starknet block number', async function () {
      await StarknetBlockCache.setLastRetrievedBlock(42);
      expect(await BaseMongoCache.cacheInstance.get('LAST_RETRIEVED_STARKNET_BLOCK')).to.equal(42);
    });
  });

  describe('getLastAuditedFinalizedBlock', function () {
    it('should get the last audited finalized starknet block number', async function () {
      await BaseMongoCache.cacheInstance.set('LAST_AUDITED_FINALIZED_STARKNET_BLOCK', 99);
      expect(await StarknetBlockCache.getLastAuditedFinalizedBlock()).to.equal(99);
    });
  });

  describe('setLastAuditedFinalizedBlock', function () {
    it('should set the last audited finalized starknet block number', async function () {
      await StarknetBlockCache.setLastAuditedFinalizedBlock(99);
      expect(await BaseMongoCache.cacheInstance.get('LAST_AUDITED_FINALIZED_STARKNET_BLOCK')).to.equal(99);
    });
  });

  describe('getLegacyAcceptedL1Block', function () {
    it('should get the legacy accepted on l1 starknet block number', async function () {
      await BaseMongoCache.cacheInstance.set('ACCEPTED_L1_BLOCK', 77);
      expect(await StarknetBlockCache.getLegacyAcceptedL1Block()).to.equal(77);
    });
  });

  describe('reset', function () {
    it('should delete only the optimistic/audited starknet checkpoint keys', async function () {
      await BaseMongoCache.cacheInstance.set('LAST_RETRIEVED_STARKNET_BLOCK', 11);
      await BaseMongoCache.cacheInstance.set('LAST_AUDITED_FINALIZED_STARKNET_BLOCK', 22);
      await BaseMongoCache.cacheInstance.set('CURRENT_STARKNET_BLOCK_NUMBER', 33);

      await StarknetBlockCache.reset();

      expect(await BaseMongoCache.cacheInstance.get('LAST_RETRIEVED_STARKNET_BLOCK')).to.equal(undefined);
      expect(await BaseMongoCache.cacheInstance.get('LAST_AUDITED_FINALIZED_STARKNET_BLOCK')).to.equal(undefined);
      expect(await BaseMongoCache.cacheInstance.get('CURRENT_STARKNET_BLOCK_NUMBER')).to.equal(33);
    });
  });
});
