const { expect } = require('chai');
const axios = require('axios');
const sinon = require('sinon');
const Block = require('@common/lib/starknet/models/Block');
const TransactionReceipt = require('@common/lib/starknet/models/TransactionReceipt');
const Event = require('@common/lib/starknet/models/Event');
const { RpcProvider } = require('@common/lib/starknet/providers');
const RpcCache = require('@common/lib/cache/StarknetRpc');
const starknetGetBlockWithTxHashes = require('./mock_data/starknet_getBlockWithTxHashes.json');
const starknetGetTransactionReceipt = require('./mock_data/starknet_getTransactionReceipt.json');
const starknetGetEvents = require('./mock_data/starknet_getEvents.json');

describe('Starknet RpcProvider', function () {
  let provider;
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    provider = new RpcProvider({ backoffOpts: { numOfAttempts: 2 } });
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('getBlock', function () {
    it('should make only one attempt if called with { withBackOff: false }', async function () {
      const stub1 = sandbox.stub(provider, '_getBlock').callsFake(async function () { return {}; });
      await provider.getBlock(1, { withBackOff: false });
      expect(stub1.callCount).to.eql(1);
    });

    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const stub1 = sandbox.stub(provider, '_getBlock').callsFake(async function () { throw new Error(); });
      try {
        await provider.getBlock(1, { withBackOff: true });
        expect.fail();
      } catch (error) {
        expect(stub1.callCount).to.eql(2);
      }
    });
  });

  describe('getBlockNumber', function () {
    it('should make only one attempt if called with { withBackOff: false }', async function () {
      const stub1 = sandbox.stub(provider, '_getBlockNumber').callsFake(async function () { return {}; });
      await provider.getBlockNumber({ withBackOff: false });
      expect(stub1.callCount).to.eql(1);
    });

    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const stub1 = sandbox.stub(provider, '_getBlockNumber').callsFake(async function () { throw new Error(); });
      try {
        await provider.getBlockNumber({ withBackOff: true });
        expect.fail();
      } catch (error) {
        expect(stub1.callCount).to.eql(2);
      }
    });

    it('should populate the transaction receipts if: withTransactionReceipts: true', async function () {
      sandbox.stub(provider, '_getBlock').callsFake(async function (blockNumber) {
        return { block_number: blockNumber, transactions: [1] };
      });
      const stub = sandbox.stub(provider, 'getTransactionReceipts').callsFake(async function () {
        return [{ foo: 'bar' }];
      });
      const block = await provider.getBlock(1, { withTransactionReceipts: true });
      expect(stub.called).to.equal(true);
      expect(block.transactions).to.have.lengthOf(1);
    });

    it('should NOT populate the transaction receipts if: withTransactionReceipts: false', async function () {
      sandbox.stub(provider, '_getBlock').callsFake(async function (blockNumber) {
        return { block_number: blockNumber, transactions: [1] };
      });
      const stub = sandbox.stub(provider, 'getTransactionReceipts').callsFake(async () => true);

      const block = await provider.getBlock(1, { withTransactionReceipts: false });
      expect(stub.called).to.equal(false);
      expect(block.transactions).to.have.lengthOf(1);
    });
  });

  describe('getEvents', function () {
    it('should get and parse the events correctly', async function () {
      const expected = {
        address: '0x020cd0c1f8cc0ca293d17b8184a6d51605ef4175827432ed24818ce24891bcdf',
        blockHash: '0x461c8f92bd2e74c2edbb9a7df2be1ba7eaac9a075939bbb85176261c09faf3',
        blockNumber: 847108,
        data: [
          '0x1',
          '0x10003',
          '0x1',
          '0x44bed59991fc8000000000000000000',
          '0x0',
          '0x177245a1cac',
          '0x0',
          '0x0',
          '0x2',
          '0x0',
          '0x0',
          '0x0'
        ],
        keys: [
          '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
          '0x43656c65737469616c'
        ],
        logIndex: 0,
        status: 'ACCEPTED_ON_L1',
        timestamp: 1692135472,
        transactionHash: '0x036de32a8ec12bfc6df831a9a5d9a8b8168a6470c0695df8e4a3ea511380dcd1',
        transactionIndex: 11
      };

      sandbox.stub(provider, '_getEvents').callsFake(async function () {
        return starknetGetEvents.result.events.map((e) => new Event(e));
      });

      sandbox.stub(provider, '_getBlockWithTxHashes').callsFake(async function () {
        return new Block(starknetGetBlockWithTxHashes.result);
      });

      sandbox.stub(provider, '_getTransactionReceipt').callsFake(async function () {
        return new TransactionReceipt(starknetGetTransactionReceipt.result);
      });

      const events = await provider.getEvents({
        address: '0x20cd0c1f8cc0ca293d17b8184a6d51605ef4175827432ed24818ce24891bcdf',
        fromBlock: 1
      });

      expect(events).to.have.lengthOf(24);
      expect(events[0]).to.deep.eql(expected);
    });
  });

  describe('getTransactionReceipts', function () {
    it('should return an array of transaction receipts', async function () {
      sandbox.stub(provider, 'getTransactionReceipt').callsFake(async function () {
        return { foo: 'bar' };
      });

      const results = await provider.getTransactionReceipts([1, 2, 3, 4]);
      expect(results).to.have.lengthOf(4);
    });
  });

  describe('getTransactionReceipt', function () {
    it('should only make one attempt if { withBackOff: false }', async function () {
      const stub = sandbox.stub(provider, '_getTransactionReceipt').callsFake(async () => { throw new Error(); });
      try {
        await provider.getTransactionReceipt(1, { withBackOff: false });
        expect.fail();
      } catch (error) {
        expect(stub.callCount);
      }
    });

    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const stub1 = sandbox.stub(provider, '_getTransactionReceipt').callsFake(async () => { throw new Error(); });
      try {
        await provider.getTransactionReceipt(1, { withBackOff: true });
        expect.fail();
      } catch (error) {
        expect(stub1.callCount).to.eql(2);
      }
    });
  });

  describe('_getTransactionReceipt', function () {
    it('should cache the result, if cacheEnabled: true', async function () {
      const txHash = '0x36de32a8ec12bfc6df831a9a5d9a8b8168a6470c0695df8e4a3ea511380dcd1';
      const spy = sandbox.spy(RpcCache, 'getTransactionReceipt');
      sandbox.stub(axios, 'post').callsFake(async function () {
        return { data: starknetGetTransactionReceipt };
      });

      await provider._getTransactionReceipt({ transactionHash: txHash, cacheEnabled: true });
      const cached = await RpcCache.getTransactionReceipt(txHash);
      expect(spy.called).to.equal(true);
      expect(cached).to.be.an('object');
    });

    it('should return the cached data if found and not make a request', async function () {
      const txHash = '0x36de32a8ec12bfc6df831a9a5d9a8b8168a6470c0695df8e4a3ea511380dcd1';
      const spy = sandbox.spy(axios, 'post');

      // put some data in cache
      await RpcCache.setTransactionReceipt(txHash, starknetGetTransactionReceipt.result);

      await provider._getTransactionReceipt({ transactionHash: txHash, cacheEnabled: true });
      expect(spy.called).to.equal(false);
    });
  });
});
