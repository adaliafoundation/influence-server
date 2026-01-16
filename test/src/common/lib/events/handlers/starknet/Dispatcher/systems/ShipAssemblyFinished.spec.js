const { expect } = require('chai');
const mongoose = require('mongoose');
const sinon = require('sinon');
const { ActivityService, PackedLotDataService } = require('@common/services');
const {
  ShipAssemblyFinished: Handler,
  ShipAssemblyStarted } = require('@common/lib/events/handlers/starknet/Dispatcher');

describe('ShipAssemblyFinished Handler', function () {
  let endEvent;
  let startEvent;
  const stubs = {
    updateBuildingTypeForLot: null
  };

  beforeEach(async function () {
    startEvent = mongoose.model('Starknet')({
      event: 'ShipAssemblyStarted',
      name: 'ShipAssemblyStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        dryDock: { id: 4294967297, label: 4 },
        dryDockSlot: 1,
        shipType: 1,
        finishTime: 1695691834,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    endEvent = mongoose.model('Starknet')({
      data: [
        '0x6', '0x1',
        '0x4', '0x100000001',
        '0x1',
        '0x5', '0x2',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'ShipAssemblyFinished',
      logIndex: 2,
      timestamp: 1695691835,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        ship: { id: 1, label: 6 },
        dryDock: { id: 4294967297, label: 4 },
        dryDockSlot: 1,
        destination: { id: 2, label: 5 },
        finishTime: 1,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('LocationComponent').create({
      entity: { id: 1, label: 6 },
      location: { id: 1, label: 3 }
    });

    stubs.updateBuildingTypeForLot = sinon.stub(PackedLotDataService, 'updateBuildingTypeForLot').resolves();
  });

  afterEach(function () {
    stubs.updateBuildingTypeForLot.restore();
    return this.utils.resetCollections(['Activity', 'Entity', 'LocationComponent']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(endEvent);
      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should resolve the correct Activity Item', async function () {
      const { doc } = await ActivityService.findOrCreateOne({
        addresses: [],
        entities: [],
        event: startEvent,
        hashKeys: ShipAssemblyStarted.hashKeys,
        unresolvedFor: [startEvent.returnValues.callerCrew]
      });

      const handler = new Handler(endEvent);
      await handler.processEvent();
      const startActivityDoc = await mongoose.model('Activity').findById(doc._id);
      expect(startActivityDoc.unresolvedFor).to.equal(null);
      expect(handler.messages._messages.length).to.equal(2);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(endEvent)).to.deep.equal(endEvent.returnValues);
    });
  });
});
