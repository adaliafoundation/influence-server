const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const ElasticSearchService = require('../ElasticSearch');

class LocationComponentService {
  static findOneByEntity(entity) {
    return mongoose.model('LocationComponent').findOne({ 'entity.uuid': Entity.toEntity(entity).uuid });
  }

  static getFullLocation(locationEntity) {
    return mongoose.model('LocationComponent').getFullLocation(Entity.toEntity(locationEntity));
  }

  static async refreshEntitiesAtLocation(locationEntity) {
    const cursor = mongoose.model('LocationComponent').find({ 'location.uuid': locationEntity.uuid }).cursor();

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      await doc.save();
      await ElasticSearchService.queueEntityForIndexing(doc.entity);
    }
  }

  static async refreshCrewLocationsAtLocation(locationEntity) {
    const cursor = mongoose.model('LocationComponent').find({
      'location.uuid': Entity.toEntity(locationEntity).uuid,
      'entity.label': Entity.IDS.CREW
    }).cursor();

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      await doc.save();
      await ElasticSearchService.queueEntityForIndexing(doc.entity);
      const _entity = Entity.toEntity(doc.entity);

      // re-index crewmates in the crew
      const crewComponentDoc = await mongoose.model('CrewComponent')
        .findOne({ 'entity.uuid': _entity.uuid }).lean(true);
      if (crewComponentDoc?.roster) {
        await Promise.all(crewComponentDoc.roster.map((crewmateId) => ElasticSearchService.queueEntityForIndexing(
          Entity.Crewmate(crewmateId)
        )));
      }
    }
  }

  static async getAsteroidForEntity(entity) {
    const _entity = Entity.toEntity(entity);
    if (_entity.isAsteroid()) return entity;
    if (_entity.isLot()) return _entity.unpackLot().asteroidEntity;
    const doc = await mongoose.model('LocationComponent')
      .findOne({ 'entity.uuid': Entity.toEntity(entity).uuid })
      .lean(true);
    return ((doc || {}).locations) ? doc.locations.find((location) => location.label === Entity.IDS.ASTEROID) : null;
  }

  static async getLotForEntity(entity) {
    if (entity.label === Entity.IDS.ASTEROID) throw new Error('Asteroid entity does not have a lot location');
    if (entity.label === Entity.IDS.LOT) return entity;
    const locationComponentDoc = await this.findOneByEntity(entity);
    return locationComponentDoc?.getLotLocation();
  }
}

module.exports = LocationComponentService;
