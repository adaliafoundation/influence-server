const { expect } = require('chai');
const mongoose = require('mongoose');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { LotService } = require('@common/services');

describe('LotService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['BuildingComponent', 'ContractAgreementComponent', 'ControlComponent', 'Entity',
      'LocationComponent', 'PrepaidAgreementComponent', 'PrepaidPolicyComponent', 'WhitelistAgreementComponent']);
  });

  describe('getLeaseStatus', function () {
    it('should return 2 if there is a lease agreement', async function () {
      const lotEntity = Entity.lotFromIndex(1, 1);
      const crewEntity = Entity.Crew(1);
      await mongoose.model('ContractAgreementComponent').create({
        entity: lotEntity,
        permission: Permission.IDS.USE_LOT,
        permitted: crewEntity
      });

      const result = await LotService.getLeaseStatus(lotEntity);
      expect(result).to.equal(2);
    });

    it('should return 0 if there is no activie policy', async function () {
      const lotEntity = Entity.lotFromIndex(1, 1);
      const result = await LotService.getLeaseStatus(lotEntity);
      expect(result).to.equal(0);
    });

    it('should return 1 if a policy exists but is not occupied by the asteroid controller', async function () {
      const asteroidEntity = Entity.Asteroid(1);
      const lotEntity = Entity.lotFromIndex(1, 1);
      this._sandbox.stub(LotService, 'hasBuildingControlledByAsteroidController').resolves(false);
      await mongoose.model('PrepaidPolicyComponent').create({
        entity: asteroidEntity,
        permission: Permission.IDS.USE_LOT
      });

      const result = await LotService.getLeaseStatus(lotEntity);
      expect(result).to.equal(1);
    });

    it('should return 0 if a policy exists but is occupied by the asteroid controller', async function () {
      const asteroidEntity = Entity.Asteroid(1);
      const lotEntity = Entity.lotFromIndex(1, 1);
      this._sandbox.stub(LotService, 'hasBuildingControlledByAsteroidController').resolves(true);
      await mongoose.model('PrepaidPolicyComponent').create({
        entity: asteroidEntity,
        permission: Permission.IDS.USE_LOT
      });

      const result = await LotService.getLeaseStatus(lotEntity);
      expect(result).to.equal(0);
    });
  });

  describe('getLotUseEntity', function () {
    it('should return the permitted entity if an agreement exists for the specified log', async function () {
      const lotEntity = Entity.Lot(1);
      const crewEntity = Entity.Crew(1);
      const contractModels = ['ContractAgreementComponent', 'PrepaidAgreementComponent', 'WhitelistAgreementComponent'];

      for (const modelName of contractModels) {
        const agreementDoc = await mongoose.model(modelName).create({
          entity: lotEntity,
          permission: Permission.IDS.USE_LOT,
          permitted: crewEntity
        });
        const lotUseEntity = await LotService.getLotUseEntity(lotEntity);
        expect(lotUseEntity).to.deep.equal({ id: 1, label: 1, uuid: '0x10001' });

        await agreementDoc.deleteOne();
      }
    });
  });

  describe('getLotOccupation', function () {
    it('should return manager if the correct lot occupation', async function () {
      let result;
      let lotUserEntity = Entity.Crew(1);
      const asteroidEntity = Entity.Asteroid(1);
      const buildingControllerEntity = Entity.Crew(1);

      await mongoose.model('ControlComponent').create({
        entity: asteroidEntity,
        controller: lotUserEntity
      });

      // manager test
      result = await LotService.getLotOccupation(Entity.Crew(1), asteroidEntity, buildingControllerEntity);
      expect(result).to.equal('manager');
      await mongoose.model('ControlComponent').deleteMany();

      // tenant test
      await mongoose.model('ControlComponent').create({
        entity: asteroidEntity,
        controller: Entity.Crew(2)
      });
      result = await LotService.getLotOccupation(lotUserEntity, asteroidEntity, buildingControllerEntity);
      expect(result).to.equal('tenant');
      await mongoose.model('ControlComponent').deleteMany();

      // squatter test
      lotUserEntity = Entity.Crew(2);
      result = await LotService.getLotOccupation(lotUserEntity, asteroidEntity, buildingControllerEntity);
      expect(result).to.equal('squatter');
      await mongoose.model('ControlComponent').deleteMany();
    });
  });

  describe('hasBuildingControlledByAsteroidController', function () {
    it('should return true if there is a building controlled by the asteroid controller', async function () {
      const lotEntity = Entity.lotFromIndex(1, 1);
      await Promise.all([
        mongoose.model('ControlComponent').create({
          entity: Entity.Building(1),
          controller: Entity.Crew(1)
        }),
        mongoose.model('ControlComponent').create({
          entity: Entity.Asteroid(1),
          controller: Entity.Crew(1)
        }),
        mongoose.model('LocationComponent').create({
          entity: Entity.Building(1),
          location: lotEntity
        }),
        mongoose.model('BuildingComponent').create({
          entity: Entity.Building(1),
          status: 1
        })
      ]);

      const result = await LotService.hasBuildingControlledByAsteroidController(lotEntity);
      expect(result).to.equal(true);
    });
  });
});
