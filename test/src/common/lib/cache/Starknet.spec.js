const { expect } = require('chai');
const mongoose = require('mongoose');
const { range } = require('lodash');
const StarknetBlockCache = require('@common/lib/cache/Starknet');

describe('StarknetBlockCache', function () {
  afterEach(async function () {
    const collection = mongoose.connection.collection('keyv');
    await collection.deleteMany({});
  });

  describe('cacheInstance (getter)', function () {
    it('should return a keyv instance ', function () {
      expect(StarknetBlockCache.cacheInstance).to.be.an('object');
    });
  });

  describe('setl1AcceptedBlock', function () {
    it('should set the l1 accepted block', async function () {
      await StarknetBlockCache.setl1AcceptedBlock(1234);
      const coll = mongoose.connection.collection('keyv');
      const result = await coll.findOne({});
      expect(result.key).to.equal('keyv:ACCEPTED_L1_BLOCK');
      expect(result.value).to.equal('{"value":1234,"expires":null}');
    });
  });

  describe('getl1AcceptedBlock: ', function () {
    it('should get the cached value of the l1 accepted block', async function () {
      await StarknetBlockCache.setl1AcceptedBlock(1234);
      const result = await StarknetBlockCache.getl1AcceptedBlock();
      expect(result).to.equal(1234);
    });
  });

  describe('setl2AcceptedBlocks: ', function () {
    it('should update the cached value of the l2 accepted blocks', async function () {
      await StarknetBlockCache.setl2AcceptedBlocks({ 1234: '0x123456' });
      const coll = mongoose.connection.collection('keyv');
      const { key, value } = await coll.findOne({});
      expect(key).to.equal('keyv:ACCEPTED_L2_BLOCKS');
      expect(value).to.equal('{"value":{"1234":"0x123456"},"expires":null}');
    });

    it('should be able to store 10,000 blocks', async function () {
      const blockData = range(12_345, 22_346).reduce((acc, blockNumber) => {
        acc[blockNumber] = `0x${blockNumber}`;
        return acc;
      }, {});
      await StarknetBlockCache.setl2AcceptedBlocks(blockData);
      const coll = mongoose.connection.collection('keyv');
      const { key, value } = await coll.findOne({});
      const parsedValue = JSON.parse(value);
      expect(key).to.equal('keyv:ACCEPTED_L2_BLOCKS');
      expect(Object.keys(parsedValue.value).length).to.eql(10_001);
    });
  });

  describe('getl2AcceptedBlocks: ', function () {
    it('should get the cached value of the l2 accepted blocks', async function () {
      await StarknetBlockCache.setl2AcceptedBlocks({ 1234: '0x123456' });
      const result = await StarknetBlockCache.getl2AcceptedBlocks();
      expect(result).to.eql({ 1234: '0x123456' });
    });
  });
});
