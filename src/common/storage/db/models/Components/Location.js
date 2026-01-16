const { Schema, model } = require('mongoose');
const Entity = require('@common/lib/Entity');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { EntityHelper } = require('@common/storage/db/helpers');

const schema = new Schema([
  ChainComponent, {
    location: { type: EntitySchema, set: EntityHelper.toEntity },
    locations: [{ type: EntitySchema, set: EntityHelper.toEntity }]
  }
], {
  collection: 'Component_Location',
  pluginTags: ['useEntitiesPlugin']
});

const getAsteroidLocation = function () {
  const _entity = Entity.toEntity(this.toJSON().entity);
  if (_entity.isAsteroid()) return this.entity.toObject();
  if (_entity.isLot()) return (_entity.unpackLot().asteroidEntity).toObject();
  return (this.toJSON().locations || []).find((e) => Entity.isAsteroid(e));
};

const getLotLocation = function () {
  const _entity = Entity.toEntity(this.toJSON().entity);
  if (_entity.isLot()) return _entity;
  return (this.toJSON().locations || []).find((e) => Entity.isLot(e));
};

const getFullLocationForEntity = async function (locationEntity, result = []) {
  if (!locationEntity) throw new Error('Missing/Invalid locationEntity');
  const entity = new Entity(locationEntity);

  if (entity.isAsteroid()) {
    result.push(entity.toObject());
    return result;
  }

  // If location is a LOT, push it and push a virtual location in for the asteroid
  if (entity.isLot()) {
    result.push(entity.toObject());
    const { asteroidEntity } = entity.unpackLot();
    result.push(asteroidEntity.toObject());

    return result;
  }

  result.push(entity.toObject());

  const doc = await model('LocationComponent').findOne({ 'entity.uuid': entity.uuid }).lean();
  if (!(doc || {}).location) return result;
  if (doc.locations) {
    result.push(...doc.locations);
    return result;
  }

  return getFullLocationForEntity(doc.location, result);
};

const preSave = async function () {
  this.locations = await getFullLocationForEntity(this.location);
};

const preValidate = async function () {
  this.locations = await getFullLocationForEntity(this.location);
};

schema.virtual('virtuals.building', {
  ref: 'BuildingComponent',
  localField: 'entity.uuid',
  foreignField: 'entity.uuid',
  justOne: true
});

schema.virtual('virtuals.deposit', {
  ref: 'DepositComponent',
  localField: 'entity.uuid',
  foreignField: 'entity.uuid',
  justOne: true
});

schema
  .plugin(uniquePathPlugin, ['entity.uuid'])
  .static('getFullLocation', getFullLocationForEntity)
  .method('getAsteroidLocation', getAsteroidLocation)
  .method('getLotLocation', getLotLocation)
  .pre('save', preSave)
  .pre('validate', preValidate)
  .index({ 'location.uuid': 1, 'entity.label': 1 })
  .index({ 'locations.uuid': 1, 'entity.label': 1 })
  .index({ 'entity.uuid': 1 }, { unique: true });

module.exports = model('LocationComponent', schema);
