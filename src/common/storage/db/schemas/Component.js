const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { EntityHelper } = require('@common/storage/db/helpers');
const EntitySchema = require('./Entity');
const { toJsonPlugin } = require('../plugins');

const schema = new mongoose.Schema({
  entity: { type: EntitySchema, set: EntityHelper.toEntity }
});

const findOneByEntity = function (entity) {
  const { uuid } = Entity.toEntity(entity);
  return this.findOne({ 'entity.uuid': uuid });
};

schema
  .static('findOneByEntity', findOneByEntity)
  .plugin(toJsonPlugin, { omit: ['_id', 'id'] });

module.exports = schema;
