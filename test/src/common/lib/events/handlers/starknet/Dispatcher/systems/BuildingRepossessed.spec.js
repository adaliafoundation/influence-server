const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/BuildingRepossessed');

describe('BuildingRepossessed Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x5', '0x01',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'BuildingRepossessed',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        building: { id: 1, label: 5 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should change the ownership of specific Activity items', async function () {
      await mongoose.model('Activity').create([
        {
          event: {
            event: 'DeliveryPackaged',
            name: 'DeliveryPackaged',
            returnValues: { dest: { id: 1, label: 5 } },
            transactionHash: '0x3',
            logIndex: 1,
            timestamp: 1,
            transactionIndex: 1
          },
          unresolvedFor: [Entity.Crew(4)]
        }
      ]);

      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('Activity').find({ 'unresolvedFor.uuid': Entity.Crew(1).uuid });
      expect(docs).to.have.lengthOf(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);

      expect(result).to.deep.equal({
        building: { label: 5, id: 1 },
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      });
    });
  });
});
