const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/DeliveryDumped');
const Entity = require('@common/lib/Entity');

describe('DeliveryDumped Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'DeliveryDumped',
      name: 'DeliveryDumped',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x1', '0x1', '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        origin: { id: 1, label: 5 },
        originSlot: 1,
        products: [{ product: 1, amount: 1 }],
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } });
    await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] });
    await mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } });
    await mongoose.model('LocationComponent').create({
      entity: { id: 1, label: 5 }, location: Entity.lotFromIndex(1, 1)
    });
    await mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'ControlComponent', 'CrewmateComponent',
      'CrewComponent', 'LocationComponent', 'StationComponent'
    ]);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({ 'event.name': 'DeliveryDumped' });
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].data).to.have.keys(['crew', 'crewmates', 'origin', 'station']);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
