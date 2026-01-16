const { expect } = require('chai');
const sinon = require('sinon');
const appConfig = require('config');
const StarknetProvider = require('@common/lib/starknet/provider');
const { DefaultStarknetProvider } = require('@common/lib/starknet/providers');

describe('Starknet Provider', function () {
  let configState;

  before(function () {
    configState = appConfig.util.cloneDeep(appConfig);

    appConfig.Starknet.provider = 'FAKE_STARKNET_PROVIDER';
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

      expect(starknetProvider.providers).to.have.lengthOf(2);
    });
  });

  describe('getBlockNumber', function () {
    it('should attempt to call getBlockNumber on all providers until one succeeds', async function () {
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
    it('should attempt to call getBlock on all providers until one succeeds', async function () {
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
});
