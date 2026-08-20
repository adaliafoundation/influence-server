const appConfig = require('config');
const { expect } = require('chai');
const mongoose = require('mongoose');
const UserService = require('@common/services/User');
const AuthService = require('@common/services/Auth');
const { AuthCache } = require('@common/lib/cache');
const starknetClient = require('@common/lib/starknet/client');

describe('AuthService', function () {
  let configState;
  let cacheCollection;

  before(function () {
    configState = appConfig.util.cloneDeep(appConfig);
    cacheCollection = mongoose.connection.collection('keyv');
  });

  after(function () {
    Object.assign(appConfig, configState);
    appConfig.util.initParam('NODE_ENV');
  });

  afterEach(async function () {
    await cacheCollection.deleteMany({});
    await this.utils.resetCollections(['User']);
  });

  describe('hasAccessToEnvironment', function () {
    it('should return true if ENV_CHECK_ENABLED undefined', function () {
      appConfig.App.envCheckEnabled = null;
      const result = AuthService.hasAccessToEnvironment({ user: { } });
      expect(result).to.equal(true);
    });

    it('should return true if ENV_CHECK_ENABLED falsy', function () {
      appConfig.App.envCheckEnabled = 0;
      let result;
      result = AuthService.hasAccessToEnvironment({ user: { } });
      expect(result).to.equal(true);

      appConfig.App.envCheckEnabled = 'false';
      result = AuthService.hasAccessToEnvironment({ user: { } });
      expect(result).to.equal(true);
    });

    it(
      'should return false if ENV_CHECK_ENABLED and user does not have envAccess to the current NODE_ENV',
      function () {
        appConfig.App.envCheckEnabled = 1;
        let result;
        result = AuthService.hasAccessToEnvironment({ user: { } });
        expect(result).to.equal(false);

        appConfig.App.envCheckEnabled = 'true';
        result = AuthService.hasAccessToEnvironment({ user: { envAccess: ['staging'] } });
        expect(result).to.equal(false);
      }
    );

    it('should return true if ENV_CHECK_ENABLED and user does have envAccess to the current NODE_ENV', function () {
      appConfig.App.envCheckEnabled = 1;
      const result = AuthService.hasAccessToEnvironment({ user: { envAccess: ['test'] } });
      expect(result).to.equal(true);
    });
  });

  describe('getTypedMessage', function () {
    it('should return a typed message', function () {
      const nonce = 'nonce';
      const message = AuthService.getTypedMessage(nonce);
      expect(message).to.deep.equal({
        domain: { name: 'Influence', version: '1.1.0', chainId: 1 },
        message: { message: 'Login to Influence', nonce },
        primaryType: 'Message',
        types: {
          Message: [
            { name: 'message', type: 'string' },
            { name: 'nonce', type: 'string' }
          ],
          StarkNetDomain: [
            { name: 'name', type: 'felt' },
            { name: 'version', type: 'felt' },
            { name: 'chainId', type: 'felt' }
          ]
        }
      });
    });
  });

  describe('getChallenge', function () {
    it('should return a challenge message', async function () {
      const address = '0x0517567ac7026ce129c950e6e113e437aa3c83716cd61481c6bb8c5057e6923e';
      const result = await AuthService.getChallenge(address);
      expect(result.message?.nonce).to.be.a('string');
    });

    it('should throw an error if address is not provided', async function () {
      let error;
      try {
        await AuthService.getChallenge();
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an('error');
    });
  });

  describe('verifyChallenge', function () {
    it('should throw if the cached nonce is missing', async function () {
      this._sandbox.stub(AuthCache, 'getLoginMessage').resolves(null);

      let error;
      try {
        await AuthService.verifyChallenge({
          address: this.GLOBALS.TEST_STARKNET_WALLET,
          signature: '1,2'
        });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');
      expect(error.message).to.equal('Authentication code expired. Please try again.');
    });

    it('should allow undeployed accounts without signature verification', async function () {
      const provider = {
        getClassAt: this._sandbox.stub().rejects(new Error('not deployed')),
        callContract: this._sandbox.stub()
      };
      const expectedUser = { address: this.GLOBALS.TEST_STARKNET_WALLET, isDeployed: false };

      this._sandbox.stub(AuthCache, 'getLoginMessage').resolves('nonce');
      this._sandbox.stub(AuthCache, 'deleteLoginMessage').resolves();
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves(provider);
      const userStub = this._sandbox.stub(UserService, 'findOrCreateByAddress').resolves(expectedUser);

      const result = await AuthService.verifyChallenge({
        address: this.GLOBALS.TEST_STARKNET_WALLET,
        signature: '1,2',
        referredBy: '0x123'
      });

      expect(provider.callContract.called).to.equal(false);
      expect(userStub.calledOnceWithExactly({
        address: this.GLOBALS.TEST_STARKNET_WALLET,
        isDeployed: false,
        referredBy: '0x123'
      })).to.equal(true);
      expect(result).to.deep.equal(expectedUser);
    });

    it('should verify deployed account signatures through the Starknet provider', async function () {
      const provider = {
        getClassAt: this._sandbox.stub().resolves({}),
        callContract: this._sandbox.stub().resolves(['1'])
      };
      const expectedUser = { address: this.GLOBALS.TEST_STARKNET_WALLET, isDeployed: true };

      this._sandbox.stub(AuthCache, 'getLoginMessage').resolves('nonce');
      this._sandbox.stub(AuthCache, 'deleteLoginMessage').resolves();
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves(provider);
      this._sandbox.stub(starknetClient.starknet.typedData, 'getMessageHash').returns('0x123');
      this._sandbox.stub(starknetClient.starknet.CallData, 'compile').returns(['compiled']);
      const userStub = this._sandbox.stub(UserService, 'findOrCreateByAddress').resolves(expectedUser);

      const result = await AuthService.verifyChallenge({
        address: this.GLOBALS.TEST_STARKNET_WALLET,
        signature: '1,2'
      });

      expect(provider.callContract.calledOnce).to.equal(true);
      expect(userStub.calledOnceWithExactly({
        address: this.GLOBALS.TEST_STARKNET_WALLET,
        isDeployed: true,
        referredBy: undefined
      })).to.equal(true);
      expect(result).to.deep.equal(expectedUser);
    });

    it('should verify Cartridge session signatures through is_session_signature_valid', async function () {
      const provider = {
        getClassAt: this._sandbox.stub().resolves({}),
        callContract: this._sandbox.stub().resolves(['1'])
      };
      const expectedUser = { address: this.GLOBALS.TEST_STARKNET_WALLET, isDeployed: true };
      appConfig.Starknet.chainId = 1;
      const marker = starknetClient.starknet.shortString.encodeShortString('session-typed-data');
      const signature = [
        marker,
        '0x1',
        '0x2',
        '0x3',
        '0x4',
        '0x5',
        '0x6',
        '0x7',
        '0x8'
      ].join(',');

      this._sandbox.stub(AuthCache, 'getLoginMessage').resolves('nonce');
      this._sandbox.stub(AuthCache, 'deleteLoginMessage').resolves();
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves(provider);
      this._sandbox.stub(UserService, 'findOrCreateByAddress').resolves(expectedUser);
      const expectedCalldata = AuthService.cartridgeSessionCalldata(AuthService.getTypedMessage('nonce'), signature);

      const result = await AuthService.verifyChallenge({
        address: this.GLOBALS.TEST_STARKNET_WALLET,
        signature
      });

      expect(provider.getClassAt.calledOnce).to.equal(true);
      expect(provider.callContract.calledOnce).to.equal(true);
      expect(provider.callContract.firstCall.args[0]).to.deep.equal({
        calldata: expectedCalldata,
        contractAddress: this.GLOBALS.TEST_STARKNET_WALLET,
        entrypoint: 'is_session_signature_valid'
      });
      expect(expectedCalldata.slice(-2)).to.deep.equal(['7', '8']);
      expect(result).to.deep.equal(expectedUser);
    });

    it('should reject invalid deployed account signatures', async function () {
      const provider = {
        getClassAt: this._sandbox.stub().resolves({}),
        callContract: this._sandbox.stub().resolves(['0'])
      };

      this._sandbox.stub(AuthCache, 'getLoginMessage').resolves('nonce');
      this._sandbox.stub(AuthCache, 'deleteLoginMessage').resolves();
      this._sandbox.stub(starknetClient, 'createRpcProvider').resolves(provider);
      this._sandbox.stub(starknetClient.starknet.typedData, 'getMessageHash').returns('0x123');
      this._sandbox.stub(starknetClient.starknet.CallData, 'compile').returns(['compiled']);

      let error;
      try {
        await AuthService.verifyChallenge({
          address: this.GLOBALS.TEST_STARKNET_WALLET,
          signature: '1,2'
        });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');
      expect(error.message).to.equal('Signature invalid.');
    });
  });
});
