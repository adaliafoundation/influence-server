const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ElasticSearchService } = require('@common/services');

describe('ElasticSearchService', function () {
  afterEach(function () {
    return this.utils.resetCollections([
      'ControlComponent', 'CrewComponent', 'IndexItem', 'LocationComponent', 'OrderComponent'
    ]);
  });

  describe('queueComponentForIndexing', function () {
    it('should queue the component for indexing, priority 10 if not specified', async function () {
      await ElasticSearchService.queueComponentForIndexing({ component: 'Order', id: 1 });
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier._id).to.equal(1);
      expect(indexItem.model).to.equal('OrderComponent');
      expect(indexItem.priority).to.equal(10);
    });

    it('should queue the component for indexing with the specified priority', async function () {
      await ElasticSearchService.queueComponentForIndexing({ component: 'Order', id: 1, priority: 20 });
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier._id).to.equal(1);
      expect(indexItem.model).to.equal('OrderComponent');
      expect(indexItem.priority).to.equal(20);
    });
  });

  describe('queueComponentsForIndexing', function () {
    it('should queue the components for indexing, priority 10 if not specified', async function () {
      const components = [{ _id: 1 }, { id: 2 }];
      await ElasticSearchService.queueComponentsForIndexing({ docs: components, component: 'Order' });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(2);
      expect(indexItems.map(({ identifier: { _id } }) => _id)).to.include(1);
      expect(indexItems.map(({ identifier: { _id } }) => _id)).to.include(2);
      expect(indexItems[0].model).to.equal('OrderComponent');
      expect(indexItems[1].model).to.equal('OrderComponent');
      expect(indexItems[0].priority).to.equal(10);
      expect(indexItems[1].priority).to.equal(10);
    });

    it('should queue the components for indexing with the specified priority', async function () {
      const components = [{ _id: 1 }, { _id: 2 }];
      await ElasticSearchService.queueComponentsForIndexing({ docs: components, component: 'Order', priority: 20 });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(2);
      expect(indexItems[0].priority).to.equal(20);
      expect(indexItems[1].priority).to.equal(20);
    });

    it('should queue documents for indexing per the specified cursor', async function () {
      const order = {
        entity: Entity.Building(1),
        crew: Entity.Crew(1),
        storage: Entity.Building(1),
        orderType: 1,
        product: 1,
        price: 1,
        storageSlot: 1
      };
      await mongoose.model('OrderComponent').create([
        { ...order, entity: Entity.Building(1) },
        { ...order, entity: Entity.Building(2) },
        { ...order, entity: Entity.Building(3) }
      ]);
      const cursor = mongoose.model('OrderComponent').find({}).cursor();
      await ElasticSearchService.queueComponentsForIndexing({ cursor, component: 'Order' });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(3);
    });
  });

  describe('queueEntityForIndexing', function () {
    it('should queue the entity for indexing, priority 10 if not specified', async function () {
      await ElasticSearchService.queueEntityForIndexing(Entity.Asteroid(1));
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier.uuid).to.equal(Entity.Asteroid(1).uuid);
      expect(indexItem.model).to.equal('Entity');
      expect(indexItem.priority).to.equal(10);
    });

    it('should queue the entity for indexing with the specified priority', async function () {
      await ElasticSearchService.queueEntityForIndexing(Entity.Asteroid(1), 20);
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier.uuid).to.equal(Entity.Asteroid(1).uuid);
      expect(indexItem.model).to.equal('Entity');
      expect(indexItem.priority).to.equal(20);
    });
  });

  describe('queueEntitiesForIndexing', function () {
    it('should queue the entities for indexing, priority 10 if not specified', async function () {
      const entities = [Entity.Asteroid(1), Entity.Asteroid(2)];
      await ElasticSearchService.queueEntitiesForIndexing({ entities: [Entity.Asteroid(1), Entity.Asteroid(2)] });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(2);
      expect(entities.map((e) => e.uuid)).to.include(indexItems[0].identifier.uuid);
      expect(entities.map((e) => e.uuid)).to.include(indexItems[1].identifier.uuid);
      expect(indexItems[0].model).to.equal('Entity');
      expect(indexItems[1].model).to.equal('Entity');
      expect(indexItems[0].priority).to.equal(10);
      expect(indexItems[1].priority).to.equal(10);
    });

    it('should queue the entities for indexing with the specified priority', async function () {
      const entities = [Entity.Asteroid(1), Entity.Asteroid(2)];
      await ElasticSearchService.queueEntitiesForIndexing({
        entities: [Entity.Asteroid(1), Entity.Asteroid(2)],
        priority: 20
      });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(2);
      expect(entities.map((e) => e.uuid)).to.include(indexItems[0].identifier.uuid);
      expect(entities.map((e) => e.uuid)).to.include(indexItems[1].identifier.uuid);
      expect(indexItems[0].model).to.equal('Entity');
      expect(indexItems[1].model).to.equal('Entity');
      expect(indexItems[0].priority).to.equal(20);
      expect(indexItems[1].priority).to.equal(20);
    });

    it('should queue documents for indexing per the specified cursor', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: Entity.Building(1), location: Entity.lotFromIndex(1, 1) },
        { entity: Entity.Building(2), location: Entity.lotFromIndex(2, 1) },
        { entity: Entity.Building(3), location: Entity.lotFromIndex(3, 1) }
      ]);
      const cursor = mongoose.model('LocationComponent').find({}).cursor();
      await ElasticSearchService.queueEntitiesForIndexing({ cursor });
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(3);
    });
  });

  describe('queueForIndexing', function () {
    it('should queue the item for indexing, priority 0 if not specified', async function () {
      await ElasticSearchService.queueForIndexing({ identifier: { uuid: Entity.Asteroid(1).uuid }, model: 'Entity' });
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier.uuid).to.equal(Entity.Asteroid(1).uuid);
      expect(indexItem.model).to.equal('Entity');
      expect(indexItem.priority).to.equal(0);
    });

    it('should queue the item for indexing with the specified priority', async function () {
      await ElasticSearchService.queueForIndexing({
        identifier: { uuid: Entity.Asteroid(1).uuid },
        model: 'Entity',
        priority: 10
      });
      const indexItem = await mongoose.model('IndexItem').findOne();
      expect(indexItem.identifier.uuid).to.equal(Entity.Asteroid(1).uuid);
      expect(indexItem.model).to.equal('Entity');
      expect(indexItem.priority).to.equal(10);
    });
  });

  describe('queueRelatedEntitiesForIndexing', function () {
    it('should queue buildings, crews, deposits, and ships located at the specified asteroid', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: Entity.Building(1), location: Entity.lotFromIndex(1, 1) },
        { entity: Entity.Ship(1), location: Entity.lotFromIndex(1, 2) },
        { entity: Entity.Crew(1), location: Entity.lotFromIndex(1, 3) },
        { entity: Entity.Deposit(1), location: Entity.lotFromIndex(1, 4) },
        { entity: Entity.Deposit(2), location: Entity.lotFromIndex(2, 1) }
      ]);

      await ElasticSearchService.queueRelatedEntitiesForIndexing(Entity.Asteroid(1));
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(4);
    });

    it('should queue crews and ships located at the specified building', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: Entity.Ship(1), location: Entity.Building(1) },
        { entity: Entity.Crew(1), location: Entity.Building(1) },
        { entity: Entity.Crew(2), location: Entity.Building(1) },
        { entity: Entity.Crew(3), location: Entity.Building(2) }
      ]);

      await ElasticSearchService.queueRelatedEntitiesForIndexing(Entity.Building(1));
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(3);
    });

    it('should queue buildings, crewmates, deposits and ships for the specified crew', async function () {
      await mongoose.model('ControlComponent').create([
        { entity: Entity.Building(1), controller: Entity.Crew(1) },
        { entity: Entity.Crewmate(1), controller: Entity.Crew(1) },
        { entity: Entity.Ship(1), controller: Entity.Crew(1) },
        { entity: Entity.Deposit(1), controller: Entity.Crew(2) }
      ]);

      await ElasticSearchService.queueRelatedEntitiesForIndexing(Entity.Crew(1));
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(3);
    });

    it('should queue crews for the specified crewmate', async function () {
      await mongoose.model('CrewComponent').create([
        { entity: Entity.Crew(1), roster: [1, 2, 3] },
        { entity: Entity.Crew(2), roster: [3, 5, 6, 7] }
      ]);

      await ElasticSearchService.queueRelatedEntitiesForIndexing(Entity.Crewmate(1));
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(1);
    });

    it('should queue crewmates for the specified ship', async function () {
      await mongoose.model('LocationComponent').create([
        { entity: Entity.Crewmate(1), location: Entity.Ship(1) },
        { entity: Entity.Crewmate(2), location: Entity.Ship(2) },
        { entity: Entity.Crewmate(3), location: Entity.Ship(1) }
      ]);

      await ElasticSearchService.queueRelatedEntitiesForIndexing(Entity.Ship(1));
      const indexItems = await mongoose.model('IndexItem').find();
      expect(indexItems).to.have.length(2);
    });
  });
});
