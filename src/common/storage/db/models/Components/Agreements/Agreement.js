const { Schema } = require('mongoose');
const { ChainComponent } = require('@common/storage/db/schemas');

const schema = new Schema([
  ChainComponent, {
    permission: { type: Number }
  }
]);

module.exports = schema;
