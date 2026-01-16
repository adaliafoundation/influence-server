const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { EntitySchema } = require('@common/storage/db/schemas');
const { Address } = require('../helpers');

const referralSchema = new mongoose.Schema({
  entity: { type: EntitySchema, required: true },
  referrer: { type: String, set: Address.toStandard, required: true }, // Referrer's address
  buyer: { type: String, set: Address.toStandard, required: true }, // Buyer's address
  price: { type: Number }, // Price of the purchase in USD
  processed: { type: Boolean, default: false } // Whether the referral has been processed
}, { timestamps: true });

const preSave = function () {
  // Standardize addresses
  if (!isNil(this.referrer)) this.referrer = Address.toStandard(this.referrer);
  if (!isNil(this.buyer)) this.buyer = Address.toStandard(this.buyer);
};

referralSchema
  .pre('save', preSave)
  .index({ buyer: 1, referrer: 1, 'entity.uuid': 1 }, { unique: true })
  .index({ referrer: 1 })
  .index({ processed: 1 });

module.exports = mongoose.model('Referral', referralSchema);
