const { expect } = require('chai');
const moment = require('moment');
const mongoose = require('mongoose');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const { LotDataCache } = require('@common/lib/cache');

describe('Packed LotData Service', function () {
  beforeEach(async function () {
    await Promise.all([
      // building 1
      mongoose.model('BuildingComponent').create({
        entity: Entity.Building(1),
        buildingType: 1,
        status: 3
      }),
      mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(250_000, 1)
      }),

      // building 2
      mongoose.model('BuildingComponent').create({
        entity: Entity.Building(2),
        buildingType: 2,
        status: 3
      }),
      mongoose.model('LocationComponent').create({
        entity: Entity.Building(2),
        location: Entity.lotFromIndex(250_000, 2)
      }),

      // building 3
      mongoose.model('BuildingComponent').create({
        entity: Entity.Building(3),
        buildingType: 2,
        status: 1
      }),
      mongoose.model('LocationComponent').create({
        entity: Entity.Building(3),
        location: Entity.lotFromIndex(250_000, 3)
      }),

      // building 4
      mongoose.model('BuildingComponent').create({
        entity: Entity.Building(4),
        buildingType: 2,
        status: 2
      }),
      mongoose.model('LocationComponent').create({
        entity: Entity.Building(4),
        location: Entity.lotFromIndex(250_000, 4)
      }),

      // ship
      mongoose.model('LocationComponent').create({
        entity: Entity.Ship(1),
        location: Entity.lotFromIndex(250_000, 5)
      }),

      // prepaid agreement
      mongoose.model('PrepaidAgreementComponent').create({
        entity: Entity.lotFromIndex(250_000, 1),
        permmitted: Entity.Crew(1),
        permission: Permission.IDS.USE_LOT,
        endTime: moment().unix() + 1000
      })
    ]);

    // clear the cache
    await LotDataCache.cacheInstance.clear();
  });

  afterEach(function () {
    return this.utils.resetCollections(['BuildingComponent', 'LocationComponent', 'PrepaidAgreementComponent']);
  });

  describe('buildForLot', function () {
    it('should build the packed data for a single lot', async function () {
      expect(await PackedLotDataService.buildForLot(Entity.lotFromIndex(250_000, 1))).to.equal('00011000');
      expect(await PackedLotDataService.buildForLot(Entity.lotFromIndex(240_000, 1))).to.equal('00000000');
    });
  });

  describe('build', function () {
    it('should build the packed data for all lots on an asteroid and update cache', async function () {
      const { packedData, packedWidth } = await PackedLotDataService.build(Entity.Asteroid(250_000));
      expect(packedData).to.eql([404807904, 4026531840, 0, 0]);
      expect(packedWidth).to.equal(8);
      expect(await PackedLotDataService.get(Entity.Asteroid(250_000))).to.eql({ packedData, packedWidth });
    });

    it('should build for the asteroid but NOT update cache (save: false)', async function () {
      const { packedData, packedWidth } = await PackedLotDataService.build(Entity.Asteroid(250_000), false);
      expect(packedData).to.eql([404807904, 4026531840, 0, 0]);
      expect(packedWidth).to.equal(8);
      expect((await PackedLotDataService.get(Entity.Asteroid(250_000))).packedData).to.eql([0, 0, 0, 0]);
    });
  });

  describe('initForAsteroid', function () {
    it('should seed the cache with empty data', async function () {
      const asteroid = Entity.Asteroid(250_000);
      await PackedLotDataService.initForAsteroid(asteroid);
      const result = await PackedLotDataService.get(asteroid);
      expect(result.packedData).to.eql([0, 0, 0, 0]);
    });
  });

  describe('updateLotLeaseStatus', function () {
    it('should update the lease status for the specified lot', async function () {
      const asteroidEntity = Entity.Asteroid(250_000);
      const lotEntity = Entity.lotFromIndex(250_000, 1);

      await PackedLotDataService.build(asteroidEntity);

      // drop the prepaid agreement (simulate expired or removed)
      await mongoose.model('PrepaidAgreementComponent')
        .deleteOne({ 'entity.uuid': Entity.lotFromIndex(250_000, 1).uuid });

      await PackedLotDataService.updateLotLeaseStatus(lotEntity);
      const packedData = await PackedLotDataService.get(asteroidEntity);

      expect(packedData.packedData).to.deep.eql([270590176, 4026531840, 0, 0]);
      expect(await PackedLotDataService.getForLot(lotEntity)).to.equal('00010000');
    });
  });

  describe('updateLotsToLeaseable', function () {
    it('should update the lease status to leased', async function () {
      const asteroidEntity = Entity.Asteroid(250_000);
      await PackedLotDataService.initForAsteroid(asteroidEntity);

      const packedData = await PackedLotDataService.updateLotsToLeaseable({ asteroidEntity });
      expect(packedData.packedData).to.deep.eql([67372036, 67372036, 67372036, 67108864]);
    });
  });

  describe('updateLotsToNonLeaseable', function () {
    it('should update/force the lease status to no leasable (clearAgreements: true)', async function () {
      const asteroidEntity = Entity.Asteroid(250_000);
      await PackedLotDataService.build(asteroidEntity);
      const packedData = await PackedLotDataService.updateLotsToNonLeaseable({ asteroidEntity, clearAgreements: true });
      expect(packedData.packedData).to.deep.eql([270590176, 4026531840, 0, 0]);
    });

    it('should update the lease status to nonleasable, unless existing agreement', async function () {
      const asteroidEntity = Entity.Asteroid(250_000);
      await PackedLotDataService.build(asteroidEntity);
      const packedData = await PackedLotDataService.updateLotsToNonLeaseable({
        asteroidEntity, clearAgreements: false
      });
      expect(packedData.packedData).to.deep.eql([404807904, 4026531840, 0, 0]);
    });
  });

  describe('get', function () {
    it('should initialize and return empty cached data if non found', async function () {
      const spy = this._sandbox.spy(PackedLotDataService, 'initForAsteroid');
      const { packedData } = await PackedLotDataService.get(Entity.Asteroid(250_000));
      expect(packedData).to.deep.equal([0, 0, 0, 0]);
      expect(spy.calledOnce).to.equal(true);
    });

    it('should get the data from cache if exists', async function () {
      const asteroidEntity = Entity.Asteroid(250_000);
      await PackedLotDataService.build(asteroidEntity);
      const packedData = await PackedLotDataService.get(asteroidEntity);
      expect(packedData.packedData).to.deep.equal([404807904, 4026531840, 0, 0]);
    });
  });

  describe('getForLot', function () {
    it('should get the data for a specific lot', async function () {
      const lot = Entity.lotFromIndex(250_000, 1);
      await PackedLotDataService.build(Entity.Asteroid(250_000));

      expect(await PackedLotDataService.getForLot(lot)).to.eql('00011000');
    });

    it('should return 0 if asteroid data not found in cache', async function () {
      const lot = Entity.lotFromIndex(1, 1);
      expect(await PackedLotDataService.getForLot(lot)).to.eql('00000000');
    });
  });

  describe('update', function () {
    it('should update the data for a specific asteroid and lot', async function () {
      // now update the building data for building 1
      await mongoose.model('BuildingComponent').updateOne(
        { 'entity.uuid': Entity.Building(1).uuid },
        { buildingType: 2, status: 3 }
      );
      const result = await PackedLotDataService.update(Entity.lotFromIndex(250_000, 1));
      expect(result.packedData).to.eql([671088640, 0, 0, 0]);
    });
  });

  describe('updateBuildingTypeForLot', function () {
    it('should update the building type in the lot data for a specific lot', async function () {
      await PackedLotDataService.build(Entity.Asteroid(250_000));
      const lot = Entity.lotFromIndex(250_000, 1);

      await mongoose.model('BuildingComponent').updateOne(
        { 'entity.uuid': Entity.Building(1).uuid },
        { buildingType: 9, status: 3 }
      );

      await PackedLotDataService.updateBuildingTypeForLot(lot);

      expect(await PackedLotDataService.getForLot(lot)).to.eql('10011000');
    });

    it('should update the building type in the lot data for a specific lot if no cached data exits', async function () {
      // await PackedLotDataService.build(Entity.Asteroid(250_000));
      const lot = Entity.lotFromIndex(250_000, 1);

      await mongoose.model('BuildingComponent').updateOne(
        { 'entity.uuid': Entity.Building(1).uuid },
        { buildingType: 9, status: 3 }
      );

      await PackedLotDataService.updateBuildingTypeForLot(lot);
      expect(await PackedLotDataService.getForLot(lot)).to.eql('10010000');
    });
  });

  describe('updateLotToLeased', function () {
    it('should update the leaseStatus for the specified lot to leased', async function () {
      await PackedLotDataService.build(Entity.Asteroid(250_000));
      const lotEntity = Entity.lotFromIndex(250_000, 2);
      const packedData = await PackedLotDataService.updateLotToLeased(lotEntity);
      expect(packedData.get(1)).to.eql('00101000');
    });
  });

  describe('updateLotCrewStatus', function () {
    it('should update the hasCrew flag for the specified lot', async function () {
      await PackedLotDataService.build(Entity.Asteroid(250_000));
      const lotEntity = Entity.lotFromIndex(250_000, 2);
      let packedData = await PackedLotDataService.updateLotCrewStatus(lotEntity);
      expect(packedData.get(1)).to.eql('00100000');

      await mongoose.model('LocationComponent').create({ entity: Entity.Crew(1), location: lotEntity });

      packedData = await PackedLotDataService.updateLotCrewStatus(lotEntity);
      expect(packedData.get(1)).to.eql('00100010');

      const lot3 = Entity.lotFromIndex(250_000, 3);
      const locationCompDoc = await mongoose.model('LocationComponent').findOne(
        { 'entity.uuid': Entity.Crew(1).uuid },
        { location: lot3 }
      );
      locationCompDoc.set('location', lot3);
      await locationCompDoc.save();

      packedData = await PackedLotDataService.updateLotCrewStatus(lotEntity);
      packedData = await PackedLotDataService.updateLotCrewStatus(lot3);
      expect(packedData.get(1)).to.eql('00100000');
      expect(packedData.get(2)).to.eql('11100010');
    });
  });

  describe('_buildingTypeOrStatus', function () {
    it('should return 1, buildingType: 1, status: 3', async function () {
      const result = await PackedLotDataService._buildingTypeOrStatus(Entity.lotFromIndex(250_000, 1));
      expect(result).to.eql(1);
    });

    it('should return 2, buildingType: 2, status: 3', async function () {
      const result = await PackedLotDataService._buildingTypeOrStatus(Entity.lotFromIndex(250_000, 2));
      expect(result).to.eql(2);
    });

    it('should return 14, status: 1', async function () {
      const result = await PackedLotDataService._buildingTypeOrStatus(Entity.lotFromIndex(250_000, 3));
      expect(result).to.eql(14);
    });

    it('should return 14, status: 2', async function () {
      const result = await PackedLotDataService._buildingTypeOrStatus(Entity.lotFromIndex(250_000, 4));
      expect(result).to.eql(14);
    });

    it('should return 15 if a ship is at the lot and no building', async function () {
      const result = await PackedLotDataService._buildingTypeOrStatus(
        Entity.lotFromIndex(250_000, 5)
      );
      expect(result).to.eql(15);
    });
  });
});
