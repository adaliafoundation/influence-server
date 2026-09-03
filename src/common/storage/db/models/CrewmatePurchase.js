const mongoose = require('mongoose');
const { Address } = require('../helpers');
const EntitySchema = require('../schemas/Entity');

const CrewmateGrantRequestSchema = new mongoose.Schema({
  recipient: { type: String, set: Address.toStandard, required: true },
  restrictedUntil: { type: Number, required: true },
  station: { type: EntitySchema, required: true },
  callerCrew: { type: EntitySchema, required: true },
  class: { type: Number, required: true },
  impactful: [{ type: Number }],
  cosmetic: [{ type: Number }],
  gender: { type: Number, required: true },
  body: { type: Number, required: true },
  face: { type: Number, required: true },
  hair: { type: Number, required: true },
  hairColor: { type: Number, required: true },
  clothes: { type: Number, required: true },
  name: { type: String, required: true }
}, { _id: false });

const schema = new mongoose.Schema({
  stripeCheckoutSessionId: { type: String, unique: true, sparse: true },
  stripeEventIds: [{ type: String }],
  stripeProductId: { type: String, required: true },
  stripePriceId: { type: String, required: true },
  purchaser: { type: String, set: Address.toStandard, required: true },
  recipient: { type: String, set: Address.toStandard, required: true },
  chainId: { type: String },
  chainSlug: { type: String },
  externalRef: { type: String },
  grantRequest: { type: CrewmateGrantRequestSchema },
  status: {
    type: String,
    enum: [
      'checkout_created',
      'paid_pending_customization',
      'grant_submitting',
      'grant_submitted',
      'grant_confirmed',
      'grant_failed'
    ],
    default: 'checkout_created'
  },
  txHash: { type: String },
  grantError: { type: String },
  grantSubmittedAt: { type: Date },
  grantedCrewmate: { type: EntitySchema },
  grantedCrew: { type: EntitySchema },
  grantedAt: { type: Date },
  paidAt: { type: Date }
}, { timestamps: true });

schema
  .index({ status: 1 })
  .index({ purchaser: 1, status: 1 })
  .index({ recipient: 1, status: 1 })
  .index({ externalRef: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CrewmatePurchase', schema);
