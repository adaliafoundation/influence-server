const appConfig = require('config');
const Keyv = require('keyv');

class BaseMongoCache {
  static _cacheInstance;

  static get cacheInstance() {
    if (!this._cacheInstance) {
      this._cacheInstance = new Keyv(appConfig.get('MongoDb.uri'));
    }

    return this._cacheInstance;
  }
}

module.exports = BaseMongoCache;
