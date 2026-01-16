const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/MaterialProcessingStarted/v0');
const Entity = require('@common/lib/Entity');

describe('MaterialProcessingStarted Handler', function () {
  let event;

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      event: 'MaterialProcessingStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        processor: { id: 1, label: 5 },
        processorSlot: 1,
        process: 1,
        inputs: [{ product: 1, amount: 1 }],
        outputs: [{ product: 2, amount: 2 }],
        destination: { id: 2, label: 5 },
        destinationSlot: 1,
        finishTime: 1695691834,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('CrewmateComponent').create({ entity: { id: 1, label: 2 } });
    await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1] });
    await mongoose.model('LocationComponent').create({ entity: { id: 1, label: 1 }, location: { id: 1, label: 5 } });
    await mongoose.model('StationComponent').create({ entity: { id: 1, label: 5 }, population: 100, stationType: 3 });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Activity', 'Entity', 'CrewmateComponent', 'CrewComponent', 'LocationComponent', 'StationComponent'
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
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x5', '0x1',
          '0x1',
          '0x1',
          '0x1', '0x1', '0x1',
          '0x1', '0x2', '0x2',
          '0x5', '0x2',
          '0x1',
          '0x6512343a',
          '0x1', '0x1',
          '0x123456789'
        ]
      });

      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
