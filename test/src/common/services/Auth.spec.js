const appConfig = require('config');
const { expect } = require('chai');
const mongoose = require('mongoose');
const AuthService = require('@common/services/Auth');

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
        domain: { name: 'Influence', chainId: 1, version: '1.1.0' },
        message: { message: 'Login to Influence', nonce },
        primaryType: 'Message',
        types: {
          Message: [
            { name: 'message', type: 'string' },
            { name: 'nonce', type: 'string' }
          ],
          StarkNetDomain: [
            { name: 'name', type: 'felt' },
            { name: 'chainId', type: 'felt' },
            { name: 'version', type: 'felt' }
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
});
