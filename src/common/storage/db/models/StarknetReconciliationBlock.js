const mongoose = require('mongoose');
const { STARKNET: { STATUSES } } = require('@common/constants');

const schema = new mongoose.Schema(
  {
    blockNumber: { type: Number, required: true, set: Number },
    blockHash: { type: String, required: true },
    status: { type: String, enum: STATUSES, required: true }
  },
  { timestamps: true }
);

schema
  .index(
    { blockNumber: 1 },
    {
      name: 'starknet_reconciliation_block_number_unique',
      unique: true
    }
  )
  .index(
    { status: 1, blockNumber: 1 },
    { name: 'starknet_reconciliation_status_block' }
  );

module.exports = mongoose.model('StarknetReconciliationBlock', schema);
