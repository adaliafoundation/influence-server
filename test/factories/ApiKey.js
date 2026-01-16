const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const uuid = require('short-uuid');
const Factory = require('./Factory');

class ApiKeyFactory extends Factory {
  static getModel() {
    return mongoose.model('ApiKey');
  }

  static async makeOne(options = {}) {
    const key = uuid.uuid();
    return new (this.getModel())({
      name: 'TEST_CLIENT',
      client_id: uuid.uuid(),
      client_secret: bcrypt.hashSync(key, 8),
      key,
      ...options
    });
  }
}

module.exports = ApiKeyFactory;
