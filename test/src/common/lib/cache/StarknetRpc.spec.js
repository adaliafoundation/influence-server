const { expect } = require('chai');
const mongoose = require('mongoose');
const StarknetRpcCache = require('@common/lib/cache/StarknetRpc');

describe('StarknetRpcCache', function () {
  let collection;

  beforeEach(function () {
    collection = mongoose.connection.collection('keyv');
  });

  afterEach(async function () {
    await collection.deleteMany({});
  });

  describe('transactionReceiptTtl (static)', function () {
    it('it should equal one day in ms', function () {
      expect(StarknetRpcCache.transactionReceiptTtl).to.equal(3_600_000);
    });
  });

  describe('blockTtl (static)', function () {
    it('it should equal one day in ms', function () {
      expect(StarknetRpcCache.blockTtl).to.equal(3_600_000);
    });
  });

  describe('setPendingTransactionReceipt', function () {
    it('should set the pending transaction receipt', async function () {
      await StarknetRpcCache.setPendingTransactionReceipt('0x123456', { status: 1 });
      const result = await collection.findOne({});
      expect(result.key).to.equal('keyv:STARKNET_PENDING_TRANSACTION_RECEIPT_0x123456');
      expect(JSON.parse(result.value).value).to.eql({ status: 1 });
    });
  });

  describe('getPendingTransactionReceipt', function () {
    it('should get the pending transaction receipt', async function () {
      await StarknetRpcCache.setPendingTransactionReceipt('0x123456', { status: 1 });
      const result = await StarknetRpcCache.getPendingTransactionReceipt('0x123456');
      expect(result).to.eql({ status: 1 });
    });
  });

  describe('setTransactionReceipt', function () {
    it('should set the transaction receipt', async function () {
      await StarknetRpcCache.setTransactionReceipt('0x123456', { status: 1 });
      const result = await collection.findOne({});
      expect(result.key).to.equal('keyv:STARKNET_TRANSACTION_RECEIPT_0x123456');
      expect(JSON.parse(result.value).value).to.eql({ status: 1 });
    });
  });

  describe('getTransactionReceipt', function () {
    it('should get the transaction receipt', async function () {
      await StarknetRpcCache.setTransactionReceipt('0x123456', { status: 1 });
      const result = await StarknetRpcCache.getTransactionReceipt('0x123456');
      expect(result).to.eql({ status: 1 });
    });
  });

  describe('setBlockWithTxHashes', function () {
    it('should set the block with tx hashes', async function () {
      await StarknetRpcCache.setBlockWithTxHashes({ blockNumber: 1234, data: { status: 1 } });
      const result = await collection.findOne({});
      expect(result.key).to.equal('keyv:STARKNET_BLOCK_W_TXHASHES_1234');
      expect(JSON.parse(result.value).value).to.eql({ status: 1 });
    });
  });
});
