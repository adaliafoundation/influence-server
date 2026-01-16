const BaseMongoCache = require('./Base');

class LotDataCache extends BaseMongoCache {
  static deleteDataForAsteroid(asteroidId) {
    return this.cacheInstance.delete(`ASTEROID_LOTS_${asteroidId}`);
  }

  static getDataForAsteroid(asteroidId) {
    return this.cacheInstance.get(`ASTEROID_LOTS_${asteroidId}`);
  }

  static setDataForAsteroid(asteroidId, data) {
    return this.cacheInstance.set(`ASTEROID_LOTS_${asteroidId}`, data);
  }
}

module.exports = LotDataCache;
