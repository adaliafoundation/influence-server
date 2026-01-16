const { expect } = require('chai');
const sinon = require('sinon');
const { SequencerProvider } = require('@common/lib/starknet/providers');

describe('Starknet SequencerProvider', function () {
  describe('getBlock', function () {
    it('should make only one attempt if called with { withBackOff: false }', async function () {
      const provider = new SequencerProvider({ endpoint: 'http://localhost:9999999' });
      const stub1 = sinon.stub(provider, '_getBlock').callsFake(async function () { return {}; });
      await provider.getBlock(1, { withBackOff: false });
      expect(stub1.callCount).to.eql(1);
    });

    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const provider = new SequencerProvider({
        endpoint: 'http://localhost:9999999',
        backoffOpts: { numOfAttempts: 2 }
      });
      const stub1 = sinon.stub(provider, '_getBlock').callsFake(async function () { throw new Error(); });
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
      const provider = new SequencerProvider({ endpoint: 'http://localhost:9999999' });
      const stub1 = sinon.stub(provider, '_getBlockNumber').callsFake(async function () { return {}; });
      await provider.getBlockNumber({ withBackOff: false });
      expect(stub1.callCount).to.eql(1);
    });

    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const provider = new SequencerProvider({
        endpoint: 'http://localhost:9999999',
        backoffOpts: { numOfAttempts: 2 }
      });
      const stub1 = sinon.stub(provider, '_getBlockNumber').callsFake(async function () { throw new Error(); });
      try {
        await provider.getBlockNumber({ withBackOff: true });
        expect.fail();
      } catch (error) {
        expect(stub1.callCount).to.eql(2);
      }
    });
  });

  describe('_getEvents', function () {
    it('should call _getBlock for each block in range', async function () {
      const provider = new SequencerProvider({ endpoint: 'http://localhost:9999999' });
      const stub = this._sandbox.stub(provider, '_getBlock').resolves({ transactionReceipts: [] });
      const results = await provider.getEvents({ address: '0x123', fromBlock: 1, toBlock: 1 });
      expect(stub.calledWith(1)).to.eql(true);
      expect(stub.callCount).to.eql(1);
      expect(results.length).to.eql(0);
    });

    it('should call _getBlock with pending if fromBlock/toBlock is pending ', async function () {
      const provider = new SequencerProvider({ endpoint: 'http://localhost:9999999' });
      const stub = this._sandbox.stub(provider, '_getBlock').resolves({ transactionReceipts: [] });
      const results = await provider.getEvents({ address: '0x123', fromBlock: 'pending', toBlock: 'pending' });
      expect(stub.calledWith('pending')).to.eql(true);
      expect(stub.callCount).to.eql(1);
      expect(results.length).to.eql(0);
    });
  });

  describe('getEvents', function () {
    it('should make multiple attempts on fail called with { withBackOff: true }', async function () {
      const provider = new SequencerProvider({ endpoint: 'http://localhost:9999999' });
      const stub1 = this._sandbox.stub(provider, '_getEvents').resolves([]);
      const results = await provider.getEvents({ address: '0x123', fromBlock: 1, toBlock: 1 });
      expect(stub1.callCount).to.eql(1);
      expect(results.length).to.eql(0);
    });
  });
});
