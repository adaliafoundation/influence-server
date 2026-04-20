const Entity = require('@common/lib/Entity');
const { LocationComponentService } = require('@common/services');
const { ValidationError } = require('../errors');

class LocationValidator {
  /**
   * Asserts two entities are at the same location (same lot or asteroid).
   *
   * @param {object} entityA - Entity with Location component (formatted)
   * @param {object} entityB - Entity with Location component (formatted)
   */
  static assertSameLocation(entityA, entityB) {
    if (!entityA?.Location?.location || !entityB?.Location?.location) {
      throw new ValidationError('Both entities must have a location');
    }

    const locA = Entity.toEntity(entityA.Location.location);
    const locB = Entity.toEntity(entityB.Location.location);

    if (locA.uuid !== locB.uuid) {
      throw new ValidationError('Entities are not at the same location');
    }
  }

  /**
   * Asserts an entity is located on the specified asteroid.
   *
   * @param {object} entity - Entity with Location component (formatted)
   * @param {number} asteroidId - Expected asteroid ID
   */
  static async assertOnAsteroid(entity, asteroidId) {
    if (!entity?.Location) throw new ValidationError('Entity has no location');

    const asteroidEntity = await LocationComponentService.getAsteroidForEntity(entity);
    if (!asteroidEntity) throw new ValidationError('Entity is not on an asteroid');

    if (asteroidEntity.id !== asteroidId) {
      throw new ValidationError(`Entity is on asteroid ${asteroidEntity.id}, expected ${asteroidId}`);
    }
  }
}

module.exports = LocationValidator;
