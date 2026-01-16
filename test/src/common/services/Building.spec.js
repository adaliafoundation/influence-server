const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { BuildingService } = require('@common/services');

describe('BuildingService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['BuildingComponent', 'LocationComponent']);
  });

  describe('getCountForAsteroid', function () {
    it('should return the Building count for the specified asteroid entity', async function () {
      await mongoose.model('BuildingComponent').create([
        { entity: Entity.Building(1), status: 1 },
        { entity: Entity.Building(2), status: 2 },
        { entity: Entity.Building(3), status: 0 }
      ]);
      await mongoose.model('LocationComponent').create([
        { entity: Entity.Building(1), location: Entity.lotFromIndex(1, 1) },
        { entity: Entity.Building(2), location: Entity.lotFromIndex(1, 2) }
      ]);

      expect(await BuildingService.getCountForAsteroid(Entity.Asteroid(1))).to.equal(2);
    });
  });
});
