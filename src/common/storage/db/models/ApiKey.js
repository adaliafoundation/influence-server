const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const uuid = require('short-uuid');

const validSecret = function (secret) {
  return bcrypt.compareSync(secret, this.client_secret);
};

const apiKeySchema = new mongoose.Schema({
  name: { type: String, required: true },
  client_id: { type: String, required: true, default: uuid.uuid },
  client_secret: { type: String, required: true }, // Hashed client secret
  key: { type: String } // DEPRECATE: Legacy plain-text key to be deprecated
});

apiKeySchema
  // Check if the key is valid
  .method('validSecret', validSecret)
  // Indices
  .index({ client_id: 1 });

module.exports = mongoose.model('ApiKey', apiKeySchema);
