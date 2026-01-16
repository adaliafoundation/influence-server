const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryCancelled');
const { ActivityService } = require('@common/services');

describe('DeliveryCancelled Handler', function () {
  let event;
  let deliveryPackagedEvent;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'DeliveryCancelled',
      name: 'DeliveryCancelled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x1', '0x1', '0x1',
        '0x5', '0x2',
        '0x1',
        '0x9', '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        origin: { id: 1, label: 5 },
        originSlot: 1,
        products: [{ product: 1, amount: 1 }],
        dest: { id: 2, label: 5 },
        destSlot: 1,
        delivery: { id: 1, label: 9 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    deliveryPackagedEvent = mongoose.model('Starknet')({
      event: 'DeliveryPackaged',
      name: 'DeliveryPackaged',
      logIndex: 1,
      timestamp: 1695691833,
      transactionIndex: 1,
      transactionHash: '0x1234567891',
      returnValues: {
        origin: { id: 1, label: 5 },
        originSlot: 1,
        products: [{ product: 1, amount: 1 }],
        dest: { id: 2, label: 5 },
        destSlot: 1,
        delivery: { id: 1, label: 9 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } });
    await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] });
    await mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } });
    await mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 });

    await ActivityService.findOrCreateOne({
      event: deliveryPackagedEvent,
      hashKeys: ['name', 'returnValues.delivery.id'],
      unresolvedFor: [deliveryPackagedEvent.returnValues.callerCrew]
    });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'CrewmateComponent', 'CrewComponent', 'LocationComponent', 'StationComponent'
    ]);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({ 'event.name': 'DeliveryCancelled' });
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'station']);
    });

    it('should resolve a DeliveryPackaged activity, if found', async function () {
      await (new Handler(event)).processEvent();
      const deliveryPackagedActivity = await mongoose.model('Activity').findOne({ 'event.name': 'DeliveryPackaged' });
      expect(deliveryPackagedActivity.unresolvedFor).to.eql(null);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
