const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Factory = require('./Factory');

class ApiKeyFactory extends Factory {
  static getModel() {
    return mongoose.model('ApiKey');
  }

  static async makeOne(options = {}) {
    const key = randomUUID();
    return new (this.getModel())({
      name: 'TEST_CLIENT',
      client_id: randomUUID(),
      client_secret: bcrypt.hashSync(key, 8),
      key,
      ...options
    });
  }
}

module.exports = ApiKeyFactory;
