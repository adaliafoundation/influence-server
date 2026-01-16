const { expect } = require('chai');
const mongoose = require('mongoose');
const BaseMongoCache = require('@common/lib/cache/Base');
const LotDataCache = require('@common/lib/cache/LotData');

describe('LotDataCache', function () {
  let collection;

  beforeEach(function () {
    collection = mongoose.connection.collection('keyv');
  });

  afterEach(async function () {
    await collection.deleteMany({});
  });

  describe('deleteDataForAsteroid', function () {
    it('should delete the cached data for the specified asteroid id', async function () {
      await BaseMongoCache.cacheInstance.set('ASTEROID_LOTS_1', { foo: 'bar' });
      expect(await BaseMongoCache.cacheInstance.get('ASTEROID_LOTS_1')).to.deep.equal({ foo: 'bar' });
      await LotDataCache.deleteDataForAsteroid(1);
      expect(await BaseMongoCache.cacheInstance.get('ASTEROID_LOTS_1')).to.equal(undefined);
    });
  });

  describe('getDataForAsteroid', function () {
    it('should return the cached data for the specified asteroid id', async function () {
      await BaseMongoCache.cacheInstance.set('ASTEROID_LOTS_1', { foo: 'bar' });
      expect(await LotDataCache.getDataForAsteroid(1)).to.deep.equal({ foo: 'bar' });
    });
  });

  describe('setDataForAsteroid', function () {
    it('should set the cached data for the specified asteroid id', async function () {
      await LotDataCache.setDataForAsteroid(1, { foo: 'bar' });
      expect(await BaseMongoCache.cacheInstance.get('ASTEROID_LOTS_1')).to.deep.equal({ foo: 'bar' });
    });
  });
});
