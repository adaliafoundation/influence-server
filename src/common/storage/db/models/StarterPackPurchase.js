const mongoose = require('mongoose');
const { Address } = require('../helpers');

const EntitySchema = require('../schemas/Entity');

const StarterPackGrantRequestSchema = new mongoose.Schema({
  recipient: { type: String, set: Address.toStandard, required: true },
  restrictedUntil: { type: Number, required: true },
  station: { type: EntitySchema, required: true },
  classes: [{ type: Number }],
  impactful: [{ type: Number }],
  cosmetic: [{ type: Number }],
  genders: [{ type: Number }],
  bodies: [{ type: Number }],
  faces: [{ type: Number }],
  hairs: [{ type: Number }],
  hairColors: [{ type: Number }],
  clothes: [{ type: Number }],
  names: [{ type: String }]
}, { _id: false });

const schema = new mongoose.Schema({
  stripeCheckoutSessionId: { type: String, unique: true, sparse: true },
  stripeEventIds: [{ type: String }],
  stripeProductId: { type: String, required: true },
  stripePriceId: { type: String, required: true },
  purchaser: { type: String, set: Address.toStandard, required: true },
  productId: { type: Number, required: true },
  externalRef: { type: String },
  grantRequest: { type: StarterPackGrantRequestSchema, required: true },
  status: {
    type: String,
    enum: ['checkout_created', 'paid', 'submitting', 'submitted', 'granted', 'grant_failed'],
    default: 'checkout_created'
  },
  txHash: { type: String },
  grantError: { type: String },
  grantedCrew: { type: EntitySchema },
  grantedAt: { type: Date }
}, { timestamps: true });

schema
  .index({ status: 1 })
  .index({ externalRef: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('StarterPackPurchase', schema);
