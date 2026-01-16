const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryReceived');
const { ActivityService } = require('@common/services');
const Entity = require('@common/lib/Entity');

describe('DeliveryReceived Handler', function () {
  let event;
  let deliverySentEvent;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'DeliveryReceived',
      name: 'DeliveryReceived',
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

    deliverySentEvent = mongoose.model('Starknet')({
      event: 'DeliverySent',
      name: 'DeliverySent',
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
        finishTime: 1,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await Promise.all([
      mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } }),
      mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] }),
      mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } }),
      mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 }),
      mongoose.model('ControlComponent').create({ entity: Entity.Building(1), controller: Entity.Crew(2) }),
      mongoose.model('ControlComponent').create({ entity: Entity.Building(2), controller: Entity.Crew(3) })
    ]);

    await ActivityService.findOrCreateOne({
      event: deliverySentEvent,
      hashKeys: ['name', 'returnValues.delivery.id'],
      unresolvedFor: [deliverySentEvent.returnValues.callerCrew]
    });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'ControlComponent', 'CrewmateComponent', 'CrewComponent', 'LocationComponent',
      'StationComponent'
    ]);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({ 'event.name': 'DeliveryReceived' });
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'station']);
    });

    it('should resolve a DeliverySent activity, if found', async function () {
      await (new Handler(event)).processEvent();
      const deliverySentActivity = await mongoose.model('Activity').findOne({ 'event.name': 'DeliverySent' });
      expect(deliverySentActivity.unresolvedFor).to.eql(null);
    });

    it('should add WS messages correctly', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      expect(handler.messages._messages).to.have.lengthOf(3);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
