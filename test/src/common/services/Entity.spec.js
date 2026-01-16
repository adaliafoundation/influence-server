const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { EntityService } = require('@common/services');

describe('EntityService', function () {
  afterEach(function () {
    return this.utils.resetCollections([
      'DeliveryComponent', 'Entity', 'LocationComponent', 'NameComponent', 'ContractAgreementComponent'
    ]);
  });

  describe('getEntities', function () {
    describe('find by id/label or uuid', function () {
      it('should create entity documents for all specified entities', async function () {
        const crewEntity = Entity.toEntity({ id: 1, label: 1 });
        const asteroidEntity = Entity.toEntity({ id: 1, label: 3 });
        await EntityService.getEntities({ id: crewEntity.id, label: crewEntity.label, format: false });
        let docs = await mongoose.model('Entity').find({ uuid: crewEntity.uuid });
        expect(docs).to.have.lengthOf(1);

        await EntityService.getEntities({ uuid: asteroidEntity.uuid, format: false });
        docs = await mongoose.model('Entity').find({ uuid: asteroidEntity.uuid });
        expect(docs).to.have.lengthOf(1);
      });

      it('should find the matching entities by id and label', async function () {
        const results = await EntityService.getEntities({ id: 1, label: 1, format: false });
        expect(results.length).to.equal(1);
        expect(results[0].id).to.equal(1);
        expect(results[0].label).to.equal(1);
        expect(results[0].uuid).to.equal('0x10001');
      });

      it('should find the matching entities by uuid', async function () {
        const results = await EntityService.getEntities({ uuid: '0x10001', format: false });
        expect(results.length).to.equal(1);
        expect(results[0].id).to.equal(1);
        expect(results[0].label).to.equal(1);
        expect(results[0].uuid).to.equal('0x10001');
      });
    });

    describe('find by match', function () {
      it('should find the matching entities by match', async function () {
        await mongoose.model('LocationComponent').create({
          entity: Entity.Building(1),
          location: Entity.lotFromIndex(1, 1)
        });

        await mongoose.model('LocationComponent').create({
          entity: Entity.Crew(1),
          location: Entity.Building(1)
        });

        const results = await EntityService.getEntities({
          match: { 'Location.locations.uuid': Entity.Asteroid(1).uuid },
          format: false
        });

        expect(results).to.have.lengthOf(2);
      });
    });

    describe('find by label', function () {
      it('should find the matching entities by label', async function () {
        await Promise.all([
          mongoose.model('Entity').create(Entity.Building(1)),
          mongoose.model('Entity').create(Entity.Crew(1))
        ]);

        await mongoose.model('LocationComponent').create({
          entity: Entity.Building(1),
          location: Entity.lotFromIndex(1, 1)
        });

        await mongoose.model('LocationComponent').create({
          entity: Entity.Crew(1),
          location: Entity.Building(1)
        });

        const results = await EntityService.getEntities({ label: 1, format: false });

        expect(results.length).to.equal(1);
      });
    });

    describe('linked component data', function () {
      it('should load the default component data for an Asteroid', async function () {
        const results = await EntityService.getEntities({ ...Entity.Asteroid(1) });
        expect(results[0]).have.keys([
          'id', 'label', 'uuid', 'entity', 'AsteroidProof', 'AsteroidReward', 'Control', 'Celestial',
          'ContractPolicy', 'Name', 'Nft', 'Orbit', 'PrepaidMerklePolicy',
          'PrepaidPolicy', 'PublicPolicy'
        ]);
      });

      it('should load the default component data for an Building', async function () {
        const results = await EntityService.getEntities({ ...Entity.Building(1), format: false });
        expect(results[0]).to.have.keys([
          'id', 'label', 'uuid', 'entity', 'Building', 'ContractAgreement', 'ContractPolicy', 'Control', 'Dock',
          'DryDock', 'Exchange', 'Extractor', 'Inventory', 'Location', 'Name', 'PrepaidAgreement', 'PrepaidPolicy',
          'Processor', 'PublicPolicy', 'Station', 'WhitelistAgreement', 'WhitelistAccountAgreement'
        ]);
      });

      it('should load the default component data for an Crew', async function () {
        const results = await EntityService.getEntities({ ...Entity.Crew(1), format: false });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'entity', 'Crew', 'Location', 'Inventory', 'Name',
          'Nft', 'Ship'
        ]);
      });

      it('should load the default component data for an Crewmate', async function () {
        const results = await EntityService.getEntities({ ...Entity.Crewmate(1) });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'entity', 'Control', 'Crewmate', 'Name', 'Nft']);
      });

      it('should load the default component data for an Delivery', async function () {
        const results = await EntityService.getEntities({ ...Entity.Delivery(1), format: false });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'entity', 'Control', 'Delivery', 'PrivateSale']);
      });

      it('should load the nested component data for an Delivery', async function () {
        await mongoose.model('LocationComponent').create([
          { entity: Entity.Building(1), location: Entity.lotFromIndex(1, 1) },
          { entity: Entity.Building(2), location: Entity.lotFromIndex(2, 1) }
        ]);

        await mongoose.model('DeliveryComponent').create({
          entity: Entity.Delivery(1),
          dest: Entity.Building(2),
          origin: Entity.Building(1)
        });

        const results = await EntityService.getEntities({ ...Entity.Delivery(1), format: false });
        expect(results[0].Delivery[0]?.dest?.Location[0]).to.be.an('object');
        expect(results[0].Delivery[0]?.origin?.Location[0]).to.be.an('object');
      });

      it('should load the default component data for an Deposit', async function () {
        const results = await EntityService.getEntities({ ...Entity.Deposit(1), format: false });
        expect(results[0]).to.have.keys(['id', 'label', 'uuid', 'entity', 'Control', 'Deposit', 'Location',
          'PrivateSale']);
      });

      it('should load the default component data for an Lot', async function () {
        const results = await EntityService.getEntities({ ...Entity.Lot(1), format: false });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'entity', 'ContractAgreement',
          'PrepaidAgreement', 'WhitelistAgreement', 'WhitelistAccountAgreement']);
      });

      it('should load the default component data for an Ship', async function () {
        const results = await EntityService.getEntities({ ...Entity.Ship(1), format: false });
        expect(results[0]).to.have.keys([
          'id', 'label', 'uuid', 'entity', 'Control', 'ContractAgreement', 'ContractPolicy', 'Inventory', 'Location',
          'Name', 'Nft', 'PrepaidAgreement', 'PrepaidPolicy', 'PublicPolicy', 'Ship', 'Station',
          'WhitelistAgreement', 'WhitelistAccountAgreement'
        ]);
      });
    });

    describe('formatting', function () {
      it('should format the data correctly for an Asteroid (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Asteroid(1), format: true });
        expect(results[0]).have.keys([
          'id', 'label', 'uuid', 'AsteroidProof', 'AsteroidReward', 'Control', 'Celestial',
          'ContractPolicies', 'Name', 'Nft', 'Orbit', 'PrepaidMerklePolicy',
          'PrepaidPolicies', 'PublicPolicies'
        ]);

        ['ContractPolicies', 'PrepaidPolicies', 'PublicPolicies'].forEach((key) => {
          expect(results[0][key]).to.be.an('array');
        });
      });

      it('should format the data correctly for an Building (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Building(1), format: true });
        expect(results[0]).to.have.keys([
          'id', 'label', 'uuid', 'Building', 'ContractAgreements', 'ContractPolicies', 'Control', 'Dock',
          'DryDocks', 'Exchange', 'Extractors', 'Inventories', 'Location', 'Name', 'PrepaidAgreements',
          'PrepaidPolicies', 'Processors', 'PublicPolicies', 'Station', 'WhitelistAgreements',
          'WhitelistAccountAgreements'
        ]);

        ['ContractPolicies', 'DryDocks', 'Extractors', 'Inventories', 'PrepaidAgreements', 'PrepaidPolicies',
          'Processors', 'PublicPolicies', 'WhitelistAgreements', 'WhitelistAccountAgreements'].forEach((key) => {
          expect(results[0][key]).to.be.an('array');
        });
      });

      it('should format the data correctly for an Crew (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Crew(1), format: true });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'Crew', 'Location', 'Inventories', 'Name',
          'Nft', 'Ship'
        ]);
      });

      it('should format the data correctly for an Crewmate (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Crewmate(1), format: true });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'Control', 'Crewmate', 'Name', 'Nft']);
      });

      it('should format the data correctly for an Delivery (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Delivery(1), format: true });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'Control', 'Delivery', 'PrivateSale']);
      });

      it('should format the data correctly for an Deposit (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Deposit(1), format: true });
        expect(results[0]).to.have.keys(['id', 'label', 'uuid', 'Control', 'Deposit', 'Location', 'PrivateSale']);
      });

      it('should format the data correctly for an Lot (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Lot(1), format: true });
        expect(results[0]).to.have.keys(['uuid', 'id', 'label', 'ContractAgreements',
          'PrepaidAgreements', 'WhitelistAgreements', 'WhitelistAccountAgreements']);

        ['ContractAgreements', 'PrepaidAgreements', 'WhitelistAgreements'].forEach((key) => {
          expect(results[0][key]).to.be.an('array');
        });
      });

      it('should format the data correctly for an Ship (format: true)', async function () {
        const results = await EntityService.getEntities({ ...Entity.Ship(1), format: true });
        expect(results[0]).to.have.keys([
          'id', 'label', 'uuid', 'Control', 'ContractAgreements', 'ContractPolicies', 'Inventories', 'Location',
          'Name', 'Nft', 'PrepaidAgreements', 'PrepaidPolicies', 'PublicPolicies', 'Ship', 'Station',
          'WhitelistAgreements', 'WhitelistAccountAgreements'
        ]);

        ['ContractAgreements', 'ContractPolicies', 'Inventories', 'PrepaidAgreements', 'PrepaidPolicies',
          'PublicPolicies', 'WhitelistAgreements', 'WhitelistAccountAgreements'].forEach((key) => {
          expect(results[0][key]).to.be.an('array');
        });
      });
    });
  });
});
