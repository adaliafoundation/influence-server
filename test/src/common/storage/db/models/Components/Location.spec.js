const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');

describe('LocationComponent Schema', function () {
  afterEach(function () {
    return this.utils.resetCollections(['LocationComponent', 'BuildingComponent', 'DepositComponent']);
  });

  describe('getAsteroidLocation', function () {
    it('should return the asteroid location for a building entity', async function () {
      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(1, 1)
      });
      expect(doc.getAsteroidLocation()).to.deep.equal(Entity.Asteroid(1));
    });
  });

  describe('getLotLocation', function () {
    it('should return the lot location entity', async function () {
      const lotEntity = Entity.lotFromIndex(1, 1);
      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: lotEntity
      });
      expect(doc.getLotLocation()).to.deep.equal(lotEntity);
    });
  });

  describe('getFullLocation (static)', function () {
    it('should return the full location for, crew on an asteroid', async function () {
      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Crew(1),
        location: Entity.Asteroid(1)
      });

      const result = await mongoose.model('LocationComponent').getFullLocation(doc.location);
      expect(result).to.deep.equal([{ id: 1, label: 3, uuid: '0x10003' }]);
    });

    it('should return the full location for, crew on a lot', async function () {
      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Crew(2),
        location: Entity.lotFromIndex(1, 1)
      });

      const result = await mongoose.model('LocationComponent').getFullLocation(doc.location);

      expect(result).to.deep.equal([
        { id: 4294967297, label: 4, uuid: '0x1000000010004' },
        { id: 1, label: 3, uuid: '0x10003' }
      ]);
    });

    it('should return the full location for, crew in a building on a lot', async function () {
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(1, 1)
      });

      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Crew(3),
        location: Entity.Building(1)
      });

      const result = await mongoose.model('LocationComponent').getFullLocation(doc.location);

      expect(result).to.deep.equal([
        { id: 1, label: 5, uuid: '0x10005' },
        { id: 4294967297, label: 4, uuid: '0x1000000010004' },
        { id: 1, label: 3, uuid: '0x10003' }
      ]);
    });
  });

  describe('building virtual', function () {
    it('should populate the building virtual', async function () {
      await mongoose.model('BuildingComponent').create({ entity: Entity.Building(1) });
      const locationDoc = await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(1, 1)
      });

      await locationDoc.populate('virtuals.building');

      expect(locationDoc.virtuals.building).to.be.an('object');
    });
  });

  describe('deposit virtual', function () {
    it('should populate the deposits virtual', async function () {
      await mongoose.model('DepositComponent').create({ entity: Entity.Deposit(1) });
      await mongoose.model('LocationComponent').create({
        entity: Entity.Deposit(1),
        location: Entity.lotFromIndex(1, 1)
      });

      const locationDoc = await mongoose.model('LocationComponent').findOne({
        location: Entity.lotFromIndex(1, 1)
      }).populate('virtuals.deposit');

      expect(locationDoc.virtuals.deposit).to.be.an('object');
    });
  });

  describe('preSave', function () {
    it('should set the locations', async function () {
      const doc = await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(1, 1)
      });

      expect(doc.locations.map((e) => e.toJSON())).to.deep.equal([
        { id: 4294967297, label: 4, uuid: '0x1000000010004' },
        { id: 1, label: 3, uuid: '0x10003' }
      ]);
    });
  });

  describe('preValidate', function () {
    it('should set the locations', async function () {
      const doc = mongoose.model('LocationComponent')({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(1, 1)
      });

      await doc.validate();
      expect(doc.locations.map((e) => e.toJSON())).to.deep.equal([
        { id: 4294967297, label: 4, uuid: '0x1000000010004' },
        { id: 1, label: 3, uuid: '0x10003' }
      ]);
    });
  });
});
