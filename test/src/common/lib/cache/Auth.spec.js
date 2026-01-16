const { expect } = require('chai');
const mongoose = require('mongoose');
const BaseMongoCache = require('@common/lib/cache/Base');
const AuthCache = require('@common/lib/cache/Auth');

describe('AuthCache', function () {
  let collection;

  beforeEach(function () {
    collection = mongoose.connection.collection('keyv');
  });

  afterEach(async function () {
    await collection.deleteMany({});
  });

  describe('deleteLoginMessage', function () {
    it('should delete the cached data for the specified address', async function () {
      await BaseMongoCache.cacheInstance.set('login-message:0x1', { foo: 'bar' });
      expect(await BaseMongoCache.cacheInstance.get('login-message:0x1')).to.deep.equal({ foo: 'bar' });
      await AuthCache.deleteLoginMessage('0x1');
      expect(await BaseMongoCache.cacheInstance.get('login-message:0x1')).to.equal(undefined);
    });
  });

  describe('getLoginMessage', function () {
    it('should return the cached data for the specified address', async function () {
      await BaseMongoCache.cacheInstance.set('login-message:0x1', { foo: 'bar' });
      expect(await AuthCache.getLoginMessage('0x1')).to.deep.equal({ foo: 'bar' });
    });
  });

  describe('setLoginMessage', function () {
    it('should set the cached data for the specified address', async function () {
      await AuthCache.setLoginMessage('0x1', { foo: 'bar' });
      expect(await BaseMongoCache.cacheInstance.get('login-message:0x1')).to.deep.equal({ foo: 'bar' });
    });
  });
});
