const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingStarted/v1');
const Entity = require('@common/lib/Entity');
const ResolvableEventNotificationService = require('@common/services/Notifications/Resolvable');

describe('MaterialProcessingStartedV1 Handler', function () {
  let event;
  let resolvableEventNotificationServiceStub;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'MaterialProcessingStartedV1',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x1',
        '0x1', '0x1', '0x1',
        '0x5', '0x2a',
        '0x1',
        '0x1', '0x2', '0x2',
        '0x5', '0x2',
        '0x1',
        `0x${(Math.floor(Date.now() / 1000) + 10000).toString(16)}`,
        '0x1', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        processor: { id: 1, label: 5 },
        processorSlot: 1,
        process: 1,
        inputs: [{ product: 1, amount: 1 }],
        origin: { id: 42, label: 5 },
        originSlot: 1,
        outputs: [{ product: 2, amount: 2 }],
        destination: { id: 2, label: 5 },
        destinationSlot: 1,
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
      'Activity', 'Entity', 'CrewmateComponent', 'CrewComponent', 'LocationComponent', 'MaterialProcessingNotification',
      'StationComponent'
    ]);
  });

  describe('hashKeys', function () {
    it('should return the correct hashKeys', function () {
      expect(Handler.hashKeys).to.deep.equal([
        'name',
        'returnValues.processor.id',
        'returnValues.processorSlot'
      ]);
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
