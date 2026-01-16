const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { EntitySchema } = require('@common/storage/db/schemas');
const Logger = require('@common/lib/logger');

const preValidate = function () {
  // if this is a lot, and the asteroid is not set, unpack the lot and set the asteroid
  if (this.label === Entity.IDS.LOT && !this.asteroid?.uuid) {
    try {
      const lot = Entity.Lot(this.id);
      if (lot) this.set('asteroid', lot.unpackLot().asteroidEntity);
    } catch (error) {
      Logger.warn(`Entity::preValidate, error unpacking lot: ${this.uuid} ${error.message}`);
    }
  }
};

const schema = new mongoose.Schema([
  EntitySchema,
  { asteroid: { type: EntitySchema } }
], { _id: true, id: false });

schema
  .pre('validate', preValidate)
  .index({ 'asteroid.uuid': 1, label: 1 })
  .index({ uuid: 1 }, { unique: true })
  .index({ label: 1 });

module.exports = mongoose.model('Entity', schema);
