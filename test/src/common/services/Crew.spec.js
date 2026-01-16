const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { CrewService } = require('@common/services');
const CardGenerator = require('@common/lib/cardGenerators/crew');

describe('CrewService', function () {
  beforeEach(async function () {
    await mongoose.model('CrewComponent').create(
      { entity: Entity.Crew(1), roster: [1, 2, 3] }
    );
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'CrewComponent', 'LocationComponent', 'StationComponent']);
  });

  describe('findStation', function () {
    it('should return station component doc for the spcified crew entity', async function () {
      await Promise.all([
        mongoose.model('LocationComponent').create({
          entity: Entity.Crew(1),
          location: Entity.Building(1)
        }),
        mongoose.model('StationComponent').create({
          entity: Entity.Building(1),
          population: 10,
          stationType: 3
        })
      ]);

      expect(await CrewService.findStation({ id: 1, label: 1 })).to.be.an('object');
      expect(await CrewService.findStation(1)).to.be.an('object');
    });
  });

  describe('generateCard', function () {
    it('should call card generator generateCard', async function () {
      await mongoose.model('Entity').updateOne({ id: 1, label: 1 }, { upsert: true });
      let stub = this._sandbox.stub(CardGenerator, 'generateCard').resolves();
      let crewDoc = { id: 1 };
      let crewmateDoc = { id: 1 };
      await CrewService.generateCard({ crewmateDoc, crewDoc });
      expect(stub.calledWith({ crewmate: crewmateDoc, crew: crewDoc })).to.eql(true);
      this._sandbox.restore();

      stub = this._sandbox.stub(CardGenerator, 'generateCard').resolves();
      const crewEntity = Entity.Crew(1);
      const crewmateEntity = Entity.Crewmate(1);
      crewmateDoc = { id: 1, label: 2, uuid: '0x10002', Crewmate: null, Name: null };
      crewDoc = { id: 1, label: 1, uuid: '0x10001', Crew: { roster: [1, 2, 3] }, Name: null };
      await CrewService.generateCard({ crewEntity, crewmateEntity });
      expect(stub.calledWith({ crewmate: crewmateDoc, crew: crewDoc })).to.eql(true);
    });
  });

  describe('getCountForAsteroid', function () {
    it('should return the crew count for the specified asteroid entity', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: { id: 1, label: Entity.IDS.BUILDING }, location: Entity.lotFromIndex(1, 1) },
        { entity: { id: 2, label: Entity.IDS.BUILDING }, location: Entity.lotFromIndex(1, 2) }
      ]);

      await mongoose.model('LocationComponent').create([
        { entity: { id: 1, label: Entity.IDS.CREW }, location: { id: 1, label: Entity.IDS.BUILDING } },
        { entity: { id: 2, label: Entity.IDS.CREW }, location: { id: 2, label: Entity.IDS.BUILDING } }
      ]);

      expect(await CrewService.getCountForAsteroid({ id: 1, label: Entity.IDS.ASTEROID })).to.equal(2);
    });
  });

  describe('getCrewForCrewmate', function () {
    it('should return the crew component doc for the specified crewmate entity', async function () {
      const doc = await CrewService.getCrewForCrewmate({ id: 1, label: Entity.IDS.CREWMATE });
      expect(doc.entity.id).to.equal(1);
      expect(doc.roster).to.deep.equal([1, 2, 3]);
    });
  });

  describe('isCaptain', function () {
    it('should return true if the crewmate is the captain of the crew', async function () {
      expect(await CrewService.isCaptain(Entity.Crew(1), Entity.Crewmate(1))).to.equal(true);
    });

    it('should return false if the crewmate is NOT the captain of the crew', async function () {
      expect(await CrewService.isCaptain(Entity.Crew(1), Entity.Crewmate(2))).to.equal(false);
    });
  });
});
