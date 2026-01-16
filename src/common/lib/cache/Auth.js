const BaseMongoCache = require('./Base');

class AuthCache extends BaseMongoCache {
  static deleteLoginMessage(address) {
    return this.cacheInstance.delete(`login-message:${address}`);
  }

  static getLoginMessage(address) {
    return this.cacheInstance.get(`login-message:${address}`);
  }

  static setLoginMessage(address, value, ttl) {
    return this.cacheInstance.set(`login-message:${address}`, value, ttl);
  }
}

module.exports = AuthCache;
