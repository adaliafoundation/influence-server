const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ShipService } = require('@common/services');

describe('ShipService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['LocationComponent']);
  });

  describe('getCountForAsteroid', function () {
    it('should return the Ship count for the specified asteroid entity', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: { id: 1, label: Entity.IDS.SHIP }, location: Entity.lotFromIndex(1, 1) },
        { entity: { id: 2, label: Entity.IDS.SHIP }, location: Entity.lotFromIndex(1, 2) }
      ]);

      expect(await ShipService.getCountForAsteroid({ id: 1, label: Entity.IDS.ASTEROID })).to.equal(2);
    });
  });
});
