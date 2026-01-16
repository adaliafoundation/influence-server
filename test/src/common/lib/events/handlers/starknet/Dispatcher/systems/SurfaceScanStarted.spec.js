const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/SurfaceScanStarted');
const ResolvableEventNotificationService = require('@common/services/Notifications/Resolvable');

describe('SurfaceScanStarted Handler', function () {
  let event;
  let resolvableEventNotificationServiceStub;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x3', '0x1',
        `0x${(Math.floor(Date.now() / 1000) + 10000).toString(16)}`,
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'SurfaceScanStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        asteroid: { id: 1, label: 3 },
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
      'Activity', 'Entity', 'CrewmateComponent', 'CrewComponent', 'LocationComponent', 'StationComponent',
      'SurfaceScanNotification'
    ]);
  });

  describe('hashKeys', function () {
    it('should return the correct hashKeys', function () {
      expect(Handler.hashKeys).to.deep.equal(['name', 'returnValues.asteroid.id']);
    });
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const { returnValues: { callerCrew } } = event.toJSON();
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].toJSON().unresolvedFor).to.deep.equal([Entity.Crew(callerCrew.id).toObject()]);
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'station']);
    });

    it('should update the marketplace(s)', async function () {
      const openSeaStub = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
      const unframedStub = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
      await (new Handler(event)).processEvent();

      expect(openSeaStub.calledOnce).to.equal(true);
      expect(unframedStub.calledOnce).to.equal(true);
    });

    it('should create a notification', async function () {
      await (new Handler(event)).processEvent();
      expect(resolvableEventNotificationServiceStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
