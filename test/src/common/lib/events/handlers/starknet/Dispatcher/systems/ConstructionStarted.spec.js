const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionStarted');
const ResolvableEventNotificationService = require('@common/services/Notifications/Resolvable');

describe('ConstructionStarted Handler', function () {
  let event;
  let resolvableEventNotificationServiceStub;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'ConstructionStarted',
      name: 'ConstructionStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x5', '0x01',
        `0x${(Math.floor(Date.now() / 1000) + 10000).toString(16)}`,
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        building: { id: 1, label: 5 },
        finishTime: Math.floor(Date.now() / 1000) + 10000,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } });
    await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] });
    await mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } });
    await mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 });

    resolvableEventNotificationServiceStub = this._sandbox
      .stub(ResolvableEventNotificationService, 'createOrUpdate')
      .resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'CrewmateComponent', 'CrewComponent', 'ConstructionNotification', 'LocationComponent',
      'StationComponent'
    ]);
  });

  describe('hashKeys', function () {
    it('should return the correct hashKeys', function () {
      expect(Handler.hashKeys).to.deep.equal([
        'name',
        'returnValues.building.id'
      ]);
    });
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);
      const { returnValues: { callerCrew } } = event.toJSON();

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].toJSON().unresolvedFor).deep.eql([Entity.Crew(callerCrew.id).toObject()]);
      expect(activityDocs[0].hash).to.eql('960100f100dfd3b694e81070df7c25be');
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'station']);
    });

    it('should create a notification', async function () {
      await (new Handler(event)).processEvent();
      expect(resolvableEventNotificationServiceStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
