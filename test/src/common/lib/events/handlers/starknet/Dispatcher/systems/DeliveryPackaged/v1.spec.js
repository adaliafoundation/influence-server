const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryPackaged/v1');
const Entity = require('@common/lib/Entity');

describe('DeliveryPackagedV1 Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'DeliveryPackagedV1',
      name: 'DeliveryPackaged',
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
        '0x1a4',
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
        price: 420,
        delivery: { id: 1, label: 9 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } });
    await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] });
    await mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } });
    await mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 });
    await mongoose.model('ControlComponent').create({ entity: { id: 2, label: 5 }, controller: { id: 2, label: 1 } });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'ControlComponent', 'CrewmateComponent',
      'CrewComponent', 'LocationComponent', 'StationComponent'
    ]);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const { returnValues: { callerCrew } } = event.toJSON();
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({ 'event.name': 'DeliveryPackaged' });
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].toJSON().unresolvedFor).to.deep.equal([
        Entity.Crew(callerCrew.id).toObject(),
        Entity.Crew(2).toObject()
      ]);
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'station']);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
