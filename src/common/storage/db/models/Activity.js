const { Schema, model } = require('mongoose');
const { compact, uniqBy } = require('lodash');
const { EntitySchema } = require('@common/storage/db/schemas');
const toJsonPlugin = require('@common/storage/db/plugins/toJson');
const { Address, EntityHelper, Hex } = require('@common/storage/db/helpers');

const isHiddenBy = function (address) {
  return this.hiddenBy.includes(address);
};

const preValidate = function () {
  // ensure standardization
  if (this.event.transactionHash) this.set('event.transactionHash', this.event.transactionHash);

  // Cleanup entities
  if (this.entities?.length > 0) {
    this.entities = uniqBy(compact(this.entities), ({ uuid }) => uuid);
  }

  // Cleanup unresolvedFor
  if (this.unresolvedFor?.length > 0) {
    this.unresolvedFor = uniqBy(compact(this.unresolvedFor), ({ uuid }) => uuid);
  }

  // Set the isUnresolved flag based on the unresolvedFor count
  this.isUnresolved = ((this.unresolvedFor || []).length > 0) ? true : null;
};

const schema = new Schema({
  addresses: [{ type: String, set: Address.toStandard }],
  data: { type: 'Mixed' },
  entities: [{ type: EntitySchema, set: EntityHelper.toEntity }],
  event: {
    event: { type: String, required: true },
    logIndex: { type: Number, required: true },
    name: { type: String },
    returnValues: { type: 'Mixed', default: {} },
    timestamp: { type: Number, required: true },
    transactionIndex: { type: Number, required: true },
    transactionHash: { type: String, required: true, set: Hex.toHex64 },
    version: { type: Number }
  },
  hash: { type: String },
  hiddenBy: [{ type: String }], // wallet address
  isUnresolved: { type: Boolean },
  unresolvedFor: [{ type: EntitySchema, set: EntityHelper.toEntity }]
}, { timestamps: true });

schema
  .plugin(toJsonPlugin)
  .method('isHiddenBy', isHiddenBy)
  .pre('validate', preValidate)
  .index({ hiddenBy: 1 })
  .index({ addresses: 1 })
  .index({ 'entities.uuid': 1 })
  .index({ hash: 1 })
  .index({ 'unresolvedFor.uuid': 1 })
  .index({ 'entities.uuid': 1, isUnresolved: 1 })
  .index({ 'event.timestamp': -1, 'event.transactionIndex': -1, 'event.logIndex': -1 })
  .index({
    'entities.uuid': 1,
    'event.name': 1,
    'event.timestamp': -1,
    'event.transactionIndex': -1,
    'event.logIndex': -1
  })
  .index({
    'entities.uuid': 1,
    'event.name': 1,
    'event.timestamp': 1,
    'event.transactionIndex': 1,
    'event.logIndex': 1
  })
  .index({ 'event.transactionHash': 1, 'event.logIndex': 1 }, { unique: true })
  .index({
    'event.name': 1,
    'event.returnValues.dest.id': 1,
    isUnresolved: 1
  }, {
    name: 'DeliveryPackaged_unresolved',
    partialFilterExpression: { 'event.name': 'DeliveryPackaged' }
  })
  .index({
    'event.name': 1,
    'data.crew.Crew.readyAt': 1
  }, {
    name: 'OngoingActivities',
    partialFilterExpression: {
      'event.name': {
        $in: [
          'BuyOrderCreated',
          'ConstructionPlanned',
          'ConstructionStarted',
          'ConstructionDeconstructed',
          'CrewEjected',
          'CrewStationed',
          'MaterialProcessingStarted',
          'ResourceExtractionStarted',
          'SamplingDepositStarted',
          'SellOrderCreated',
          'ShipAssemblyStarted',
          'ShipDocked',
          'ShipUndocked'
        ]
      }
    }
  });

schema.virtual('_virtuals.event', {
  foreignField: 'transactionHash',
  match({ event: { logIndex } }) {
    return { logIndex };
  },
  justOne: true,
  localField: 'event.transactionHash',
  ref: 'Event'
});

schema.virtual('_virtuals.eventAnnotations', {
  ref: 'EventAnnotation',
  localField: 'event.transactionHash',
  foreignField: 'annotated.transactionHash',
  match({ event: { logIndex, transactionHash } }) {
    return {
      'annotated.logIndex': logIndex,
      'annotated.transactionHash': transactionHash
    };
  }
});

module.exports = model('Activity', schema);
