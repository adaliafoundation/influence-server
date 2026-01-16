const { Schema } = require('mongoose');
const { Hex } = require('@common/storage/db/helpers');

const schema = new Schema({
  activity: { type: Schema.Types.ObjectId, ref: 'Activity' },
  event: {
    event: { type: String, required: true },
    logIndex: { type: Number, required: true },
    name: { type: String, required: true },
    returnValues: { type: Object, required: true },
    transactionIndex: { type: Number, required: true },
    transactionHash: { type: String, required: true, set: Hex.toHex64 }
  }
});

module.exports = schema;
