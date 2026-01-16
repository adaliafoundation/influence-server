const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const ActivityService = require('@common/services/Activity');
const { StarknetEventFactory } = require('@test/factories');

describe('ActivityService', function () {
  let activities;
  let events;
  let crewEntity1;
  let crewEntity2;

  beforeEach(async function () {
    events = await Promise.all([
      StarknetEventFactory.createOne({ event: 'Test1', transactionHash: '0x123' }),
      StarknetEventFactory.createOne({ event: 'Test2', transactionHash: '0x1234' }),
      StarknetEventFactory.createOne({ event: 'Test3', transactionHash: '0x12345' })
    ]);

    crewEntity1 = Entity.Crew(1);
    crewEntity2 = Entity.Crew(2);
    const createActivities = mongoose.model('Activity').create([
      {
        entities: [crewEntity1],
        event: {
          logIndex: events[0].logIndex,
          event: events[0].event,
          returnValues: { entity: { id: 1, label: 1 } },
          timestamp: events[0].timestamp,
          transactionIndex: events[0].transactionIndex,
          transactionHash: events[0].transactionHash
        },
        hash: 'c2db0793a2b8c8f20af9215f4c5b0711',
        unresolvedFor: [crewEntity1]
      },
      {
        entities: [crewEntity2],
        event: {
          logIndex: events[1].logIndex,
          event: events[1].event,
          returnValues: { entity: { id: 2, label: 1 } },
          timestamp: events[1].timestamp + 10,
          transactionIndex: events[1].transactionIndex,
          transactionHash: events[1].transactionHash
        },
        hash: 'e6ec6632609860f23a78cfcfebc2b52f',
        unresolvedFor: [crewEntity1]
      },
      {
        entities: [crewEntity2, crewEntity1],
        event: {
          logIndex: events[2].logIndex,
          event: events[2].event,
          returnValues: { entity: { id: 3, label: 1 } },
          timestamp: events[2].timestamp + 20,
          transactionIndex: events[2].transactionIndex,
          transactionHash: events[2].transactionHash
        },
        hash: 'd9d1f0b1026782346c05659bd76b6e0e',
        unresolvedFor: [crewEntity2]
      }
    ]);

    const createNameComponents = mongoose.model('NameComponent').create([
      { entity: crewEntity1, name: 'Entity 1' },
      { entity: crewEntity2, name: 'Entity 2' }
    ]);

    [activities] = await Promise.all([createActivities, createNameComponents]);
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Event', 'NameComponent']);
  });

  describe('findOrCreateOne', function () {
    it('should dedup the unresolvedFor values', async function () {
      const { doc: result } = await ActivityService.findOrCreateOne({
        data: { foo: 'bar' },
        event: await StarknetEventFactory.createOne({ event: 'TEST 123', transactionHash: '0x8493' }),
        unresolvedFor: [Entity.Crew(1), Entity.Crew(1), Entity.Crew(2)]
      });
      expect(result.unresolvedFor).to.have.lengthOf(2);
      expect(result.isUnresolved).to.eql(true);
    });
  });

  describe('findForEntity', function () {
    it('should return activities for an entity', async function () {
      const { docs } = await ActivityService.findForEntity(crewEntity1);
      expect(docs).to.have.lengthOf(2);
    });

    it('should return activities for an entity with populated components', async function () {
      const { docs } = await ActivityService.findForEntity(crewEntity1, { components: ['Name'] });
      expect(docs).to.have.lengthOf(2);
      docs.forEach(({ entities }) => {
        entities.forEach((entity) => {
          expect(entity).to.haveOwnProperty('Name');
        });
      });
    });

    it('should sort the returned actitivies correctly', async function () {
      let results;

      results = await ActivityService.findForEntity(crewEntity1, { order: 'ASC' });
      expect(results.docs[0].event.event).to.eql('Test1');

      results = await ActivityService.findForEntity(crewEntity1, { order: 'DESC' });
      expect(results.docs[0].event.event).to.eql('Test3');
    });

    it('should limit the results based on the specified pageSize', async function () {
      let results;

      results = await ActivityService.findForEntity(crewEntity1, { pageSize: 1 });
      expect(results.docs.length).to.eql(1);

      results = await ActivityService.findForEntity(crewEntity1, { pageSize: 2 });
      expect(results.docs.length).to.eql(2);
    });
  });

  describe('hideFrom', function () {
    it('should hide the activity from the specified address', async function () {
      await ActivityService.hideFrom({ id: activities[0].id, address: '0x123' });
      const activity = await mongoose.model('Activity').findById(activities[0].id);
      expect(activity.hiddenBy).to.have.lengthOf(1);
      expect(activity.hiddenBy[0]).to.eql('0x123');
    });
  });

  describe('find', function () {
    it('should return the correct number of activities', async function () {
      let results;
      results = await ActivityService.find({ filter: {} });
      expect(results.docs.length).to.eql(3);

      results = await ActivityService.find({ returnTotal: true });
      expect(results.totalCount).to.eql(3);

      results = await ActivityService.find({});
      expect(results.totalCount).to.eql(null);

      results = await ActivityService.find({ pageSize: 1 });
      expect(results.docs.length).to.eql(1);

      results = await ActivityService.find({ pageSize: 0 });
      expect(results.docs.length).to.eql(3);

      results = await ActivityService.find({ page: 0 });
      expect(results.docs.length).to.eql(3);

      results = await ActivityService.find({ page: 1 });
      expect(results.docs.length).to.eql(3);

      results = await ActivityService.find({ page: 3, pageSize: 1 });
      expect(results.docs.length).to.eql(1);

      results = await ActivityService.find({ page: 2, pageSize: 2 });
      expect(results.docs.length).to.eql(1);
    });

    it('should sort the activity results correctly', async function () {
      const block1Timestamp = moment().unix();
      const block2Timestamp = block1Timestamp + 1000;
      const activityItems = await mongoose.model('Activity').create([
        { // block 1, transaction 1
          event: {
            logIndex: 1,
            event: 'foo',
            name: 'foo',
            returnValues: {},
            timestamp: block1Timestamp,
            transactionIndex: 1,
            transactionHash: '0x1234'
          }
        },
        { // block 1, transaction 1
          event: {
            logIndex: 2,
            event: 'foo',
            name: 'foo',
            returnValues: {},
            timestamp: block1Timestamp,
            transactionIndex: 1,
            transactionHash: '0x1234'
          }
        },
        { // block 1, transaction 2
          entities: [crewEntity1],
          event: {
            logIndex: 1,
            event: 'foo',
            name: 'foo',
            returnValues: {},
            timestamp: block1Timestamp,
            transactionIndex: 2,
            transactionHash: '0x12345'
          }
        },
        { // block 2, transaction 1
          entities: [crewEntity1],
          event: {
            logIndex: 1,
            event: 'foo',
            name: 'foo',
            returnValues: {},
            timestamp: block2Timestamp,
            transactionIndex: 1,
            transactionHash: '0x123456'
          }
        }
      ]);

      const { docs, totalCount } = await ActivityService.find({ filter: { 'event.event': 'foo' }, returnTotal: true });
      expect(totalCount).to.eql(4);
      expect(docs[0].event.transactionHash).to.eql(activityItems[3].event.transactionHash);
      expect(docs[1].event.transactionHash).to.eql(activityItems[2].event.transactionHash);
      expect(docs[2].event.transactionHash).to.eql(activityItems[0].event.transactionHash);
      expect(docs[2].event.logIndex).to.eql(2);
      expect(docs[3].event.transactionHash).to.eql(activityItems[0].event.transactionHash);
      expect(docs[3].event.logIndex).to.eql(1);
    });
  });

  describe('findStartActivity', function () {
    it('should find the coresponding start activity if hash match and newer timestamp', async function () {
      const doc = await ActivityService.findStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp + 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(doc.hash).to.eql('c2db0793a2b8c8f20af9215f4c5b0711');
    });

    it('should find the coresponding start activity if hash match, same timestamp but newer tx', async function () {
      const doc = await ActivityService.findStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp,
          transactionIndex: events[0].transactionIndex + 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(doc.hash).to.eql('c2db0793a2b8c8f20af9215f4c5b0711');
    });

    it('should return null on no match', async function () {
      const doc = await ActivityService.findStartActivity(
        'asdf',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(doc).to.eql(null);
    });

    it('should return null on hash match but older timestamp', async function () {
      const doc = await ActivityService.findStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp - 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(doc).to.eql(null);
    });

    it('should return null on hash match, timestamp match but older tx', async function () {
      const doc = await ActivityService.findStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp,
          transactionIndex: events[0].transactionIndex - 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(doc).to.eql(null);
    });
  });

  describe('purgeByRemoved', function () {
    it('should remove activities matching removed events', async function () {
      await Promise.all([
        events[0].set('removed', true).save(),
        events[1].set('removed', true).save()
      ]);

      await ActivityService.purgeByRemoved();

      const docs = await mongoose.model('Activity').find({});
      expect(docs.length).to.eql(1);
    });
  });

  describe('resolveStartActivity', function () {
    it('should resolve the coresponding start activity', async function () {
      const { status, doc } = await ActivityService.resolveStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp + 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' }
        },
        ['name', 'returnValues.entity.id']
      );
      expect(status).to.eql('RESOLVED');
      expect(doc.unresolvedFor).to.eql(null);
      expect(doc.isUnresolved).to.eql(null);
    });

    it('should return ALREADY_RESOLVED if already updated', async function () {
      await ActivityService.resolveStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp + 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' }
        },
        ['name', 'returnValues.entity.id']
      );

      const { status } = await ActivityService.resolveStartActivity(
        'Test1',
        { event: 'Test2',
          name: 'Test2',
          timestamp: events[0].timestamp + 1,
          returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' }
        },
        ['name', 'returnValues.entity.id']
      );
      expect(status).to.eql('ALREADY_RESOLVED');
    });

    it('should return NOT_FOUND if not found', async function () {
      const { status } = await ActivityService.resolveStartActivity(
        'Test4',
        { event: 'Test1', name: 'Test1', returnValues: { entity: { id: 1, label: 1 }, foo: 'bar' } },
        ['name', 'returnValues.entity.id']
      );
      expect(status).to.eql('NOT_FOUND');
    });
  });

  describe('updateUnresolvedFor', function () {
    it('should update the unresolvedFor field based on the specified filter', async function () {
      await ActivityService.updateUnresolvedFor(Entity.Crew(100), {
        $or: [
          { 'event.event': 'Test1', 'event.returnValues.entity.id': 1 },
          { 'event.event': 'Test2', 'event.returnValues.entity.id': 2 }
        ]
      });

      const results = await mongoose.model('Activity').find({ 'unresolvedFor.uuid': Entity.Crew(100).uuid });
      expect(results).to.have.lengthOf(2);
    });
  });

  describe('_getHash', function () {
    it('should calculate the correct hash', function () {
      let result;
      const eventData = {
        event: 'FooBar',
        name: 'FooBar',
        returnValues: { entity: { id: 1, label: 1 } }
      };

      result = ActivityService._getHash(
        eventData,
        ['name', 'returnValues.entity.id']
      );
      expect(result).to.eql('061e90c786cdc34bd86b7e412f61b4c5');

      result = ActivityService._getHash(
        eventData,
        ['name', 'returnValues.entity.id'],
        'Test'
      );
      expect(result).to.eql('e1b849f9631ffc1829b2e31402373e3c');
    });
  });
});
