const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { LocationComponentService } = require('@common/services');

describe('LocationComponentService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'CrewComponent', 'LocationComponent', 'IndexItem']);
  });

  describe('getAsteroidForEntity', function () {
    it('should return the asteroid entity, entity exists on an asteroid', async function () {
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.Lot(6881662889623553)
      });

      expect(await LocationComponentService.getAsteroidForEntity(Entity.Building(1)))
        .to.deep.equal(Entity.Asteroid(1));

      expect(await LocationComponentService.getAsteroidForEntity(Entity.Asteroid(1)))
        .to.deep.equal(Entity.Asteroid(1));

      expect(await LocationComponentService.getAsteroidForEntity(Entity.Lot(6881662889623553)))
        .to.deep.equal(Entity.Asteroid(1));
    });
  });

  describe('refreshEntitiesAtLocation', function () {
    it('should update the full location for all entities at the location', async function () {
      // building
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.Lot(6881662889623553)
      });

      // ship
      const shipLocationDoc = await mongoose.model('LocationComponent').create({
        entity: Entity.Ship(1),
        location: Entity.Building(1)
      });

      // crew
      await mongoose.model('LocationComponent').create({
        entity: Entity.Crew(1),
        location: Entity.Ship(1)
      });

      // update the ship location
      shipLocationDoc.set('location', Entity.Asteroid(1));
      await shipLocationDoc.save();

      await LocationComponentService.refreshEntitiesAtLocation(Entity.Ship(1));
      const crewLocationDoc = await mongoose.model('LocationComponent')
        .findOne({ 'entity.uuid': Entity.Crew(1).uuid })
        .lean(true);

      expect(crewLocationDoc.locations.length).to.equal(2);
      expect(crewLocationDoc.locations).to.deep.include(Entity.Ship(1));
      expect(crewLocationDoc.locations).to.deep.include(Entity.Asteroid(1));
    });
  });

  describe('refreshCrewLocationsAtLocation', function () {
    it('should update the full location for all crew at the location and re-index crewmates', async function () {
      // building
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.Lot(6881662889623553)
      });

      // ship
      const shipLocationDoc = await mongoose.model('LocationComponent').create({
        entity: Entity.Ship(1),
        location: Entity.Building(1)
      });

      // crew
      await mongoose.model('LocationComponent').create({
        entity: Entity.Crew(1),
        location: Entity.Ship(1)
      });

      await mongoose.model('CrewComponent').create({
        entity: Entity.Crew(1),
        roster: [1, 2]
      });

      // update the ship location
      shipLocationDoc.set('location', Entity.Asteroid(1));
      await shipLocationDoc.save();

      await LocationComponentService.refreshCrewLocationsAtLocation(Entity.Ship(1));
      const crewLocationDoc = await mongoose.model('LocationComponent')
        .findOne({ 'entity.uuid': Entity.Crew(1).uuid })
        .lean(true);

      expect(crewLocationDoc.locations.length).to.equal(2);
      expect(crewLocationDoc.locations).to.deep.include(Entity.Ship(1));
      expect(crewLocationDoc.locations).to.deep.include(Entity.Asteroid(1));
      expect(await mongoose.model('IndexItem').countDocuments()).to.equal(3);
    });
  });

  describe('getLotForEntity', function () {
    beforeEach(async function () {
      await mongoose.model('LocationComponent').create({
        entity: { id: 1, label: Entity.IDS.BUILDING },
        location: { id: 6881662889623553, label: Entity.IDS.LOT }
      });

      await mongoose.model('LocationComponent').create({
        entity: { id: 1, label: Entity.IDS.CREW },
        location: { id: 1, label: Entity.IDS.BUILDING }
      });
    });

    it('should return the lot entity for which the building is located', async function () {
      const lotLocation = await LocationComponentService.getLotForEntity({ id: 1, label: Entity.IDS.BUILDING });
      expect(lotLocation).to.deep.equal(Entity.Lot(6881662889623553));
    });

    it('should return the lot entity for which the crew is located', async function () {
      const lotLocation = await LocationComponentService.getLotForEntity({ id: 1, label: Entity.IDS.CREW });
      expect(lotLocation).to.deep.equal(Entity.Lot(6881662889623553));
    });

    it('should throw an error if the entity is an asteroid', async function () {
      let _error;
      try {
        await LocationComponentService.getLotForEntity(Entity.Asteroid(1));
      } catch (error) {
        _error = error;
      }
      expect(_error.message).to.equal('Asteroid entity does not have a lot location');
    });
  });
});
