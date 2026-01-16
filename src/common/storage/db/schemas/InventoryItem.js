const { Schema } = require('mongoose');

const schema = new Schema({
  product: { type: Number },
  amount: { type: Number }
}, { _id: false });

module.exports = schema;
