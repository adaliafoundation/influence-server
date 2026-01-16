const mongoose = require('mongoose');

class ApiKeyService {
  static findByClient(clientId) {
    return mongoose.model('ApiKey').findOne({ client_id: clientId });
  }
}

module.exports = ApiKeyService;
