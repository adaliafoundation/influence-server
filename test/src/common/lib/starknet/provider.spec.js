const { expect } = require('chai');
const sinon = require('sinon');
const appConfig = require('config');
const StarknetProvider = require('@common/lib/starknet/provider');
const { DefaultStarknetProvider } = require('@common/lib/starknet/providers');

describe('Starknet Provider', function () {
  let configState;

  before(function () {
    configState = appConfig.util.cloneDeep(appConfig);

    appConfig.Starknet.rpcProvider = 'FAKE_STARKNET_RPC_PROVIDER';
  });

  after(function () {
    Object.assign(appConfig, configState);
  });

  describe('constructor', function () {
    it('should set the providers to the specified providers if valid', function () {
      const starknetProvider = new StarknetProvider({
        providers: [new DefaultStarknetProvider()]
      });

      expect(starknetProvider.providers).to.have.lengthOf(1);
    });

    it('should throw an error if any provided providers are invalid', function () {
      try {
        const starknetProvider = new StarknetProvider({
          providers: [{ endpoint: 'foo' }]
        });
        expect(starknetProvider).to.eql(undefined);
        expect.fail();
      } catch (error) {
        expect(error.message).to.deep.include('provider not instance of DefaultStarknetProvider');
      }
    });

    it('should set the providers to the default if non provided', function () {
      const starknetProvider = new StarknetProvider();

      expect(starknetProvider.providers).to.have.lengthOf(1);
    });
  });

  describe('getBlockNumber', function () {
    it('should retry getBlockNumber according to backoff options', async function () {
      const starknetProvider = new StarknetProvider({ backoffOpts: { numOfAttempts: 3 } });
      const fake = function () { throw new Error(); };
      const stub1 = sinon.stub(starknetProvider.providers[0], '_getBlockNumber').callsFake(fake);
      try {
        await starknetProvider.getBlockNumber();
      } catch (error) {
        expect(stub1.callCount).to.eql(3);
      }
    });
  });

  describe('getBlock', function () {
    it('should retry getBlock according to backoff options', async function () {
      const starknetProvider = new StarknetProvider({ backoffOpts: { numOfAttempts: 3 } });
      const fake = function () { throw new Error(); };
      const stub1 = sinon.stub(starknetProvider.providers[0], '_getBlock').callsFake(fake);
      try {
        await starknetProvider.getBlock(5);
      } catch (error) {
        expect(stub1.callCount).to.eql(3);
      }
    });
  });

  describe('getEvents', function () {
    it('should pass through options to the underlying provider', async function () {
      const starknetProvider = new StarknetProvider();
      const stub = sinon.stub(starknetProvider.providers[0], 'getEvents').resolves([]);

      await starknetProvider.getEvents(
        { address: '0x1', fromBlock: 1, toBlock: 1 },
        { withBackOff: false }
      );

      expect(stub.calledOnceWithExactly(
        { address: '0x1', addresses: undefined, fromBlock: 1, toBlock: 1 },
        { withBackOff: false }
      )).to.eql(true);
    });
  });
});
