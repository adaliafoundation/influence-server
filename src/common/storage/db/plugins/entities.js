const { chain, castArray } = require('lodash');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const EntitySchema = require('../schemas/Entity');

const hasEntitySchema = function (path) {
  return path.schema?.options?.__type === 'Entity';
};

const plugin = function (schema) {
  const getEntities = function (instance) {
    return chain(schema.paths).reduce((acc, value, key) => {
      if (hasEntitySchema(value) && key !== 'entities') acc.push(...castArray(instance.get(key)));
      return acc;
    }, [])
      .compact()
      .map((entity) => Entity.toEntity(entity))
      .uniqBy(({ uuid }) => uuid)
      .value();
  };

  // Set the entities value to a unique array of entities
  const preValidate = function () {
    const entities = getEntities(this);
    this.set('entities', entities);
  };

  // For each entity, create an entity document
  const preUpdateOne = async function () {
    const entities = getEntities(this);

    // for each entity, create an entity document
    await Promise.all(entities.map((entity) => {
      const _entity = Entity.toEntity(entity);
      return mongoose.model('Entity').updateOne({ uuid: _entity.uuid }, _entity, { upsert: true });
    }));
  };

  const preReplaceOne = async function () {
    const entities = getEntities(this);

    // for each entity, create an entity document
    await Promise.all(entities.map((entity) => {
      const _entity = Entity.toEntity(entity);
      return mongoose.model('Entity').updateOne({ uuid: _entity.uuid }, _entity, { upsert: true });
    }));
  };

  const preSave = async function () {
    const entities = getEntities(this);

    // for each entity, create an entity document
    await Promise.all(entities.map(async (entity) => {
      const _entity = Entity.toEntity(entity);
      const doc = mongoose.model('Entity').hydrate(_entity);
      await doc.validate();
      return mongoose.model('Entity').updateOne({ uuid: doc.uuid }, doc, { upsert: true });
    }));
  };

  schema
    .add({ entities: { type: [EntitySchema] } })
    .pre('updateOne', preUpdateOne)
    .pre('replaceOne', preReplaceOne)
    .pre('save', preSave)
    .pre('validate', preValidate);
};

module.exports = plugin;
