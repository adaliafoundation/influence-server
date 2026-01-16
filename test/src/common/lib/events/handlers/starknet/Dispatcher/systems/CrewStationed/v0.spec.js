const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewStationed/v0');

describe('CrewStationed Handler', function () {
  let event;
  const stubs = {
    updateLotCrewStatus: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'CrewStationed',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        station: { id: 1, label: 5 },
        finishTime: 1,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    stubs.updateLotCrewStatus = this._sandbox.stub(PackedLotDataService, 'updateLotCrewStatus').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'LocationComponent']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should update the packed lot data for the crew status', async function () {
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(250_000, 1)
      });

      const handler = new Handler(event);

      await handler.processEvent();
      expect(stubs.updateLotCrewStatus.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
