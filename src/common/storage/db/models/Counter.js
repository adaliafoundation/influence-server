const { Schema, model } = require('mongoose');

const schema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

module.exports = model('Counter', schema);
