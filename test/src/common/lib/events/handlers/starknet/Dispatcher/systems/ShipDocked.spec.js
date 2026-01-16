const { expect } = require('chai');
const mongoose = require('mongoose');
const sinon = require('sinon');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipDocked');

describe('ShipDocked Handler', function () {
  let event;
  const stubs = {
    updateBuildingTypeForLot: null
  };

  before(async function () {
    event = mongoose.model('Starknet')({
      event: 'ShipDocked',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x6', '0x1',
        '0x5', '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        ship: { id: 1, label: 6 },
        dock: { id: 1, label: 5 },
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    await mongoose.model('LocationComponent').create({
      entity: Entity.Building(5),
      location: Entity.Lot(4294967297)
    });
    await mongoose.model('LocationComponent').create({
      entity: Entity.Ship(1),
      location: Entity.Building(5)
    });

    stubs.updateBuildingTypeForLot = sinon.stub(PackedLotDataService, 'updateBuildingTypeForLot').resolves();
  });

  afterEach(function () {
    stubs.updateBuildingTypeForLot.restore();
    return this.utils.resetCollections(['Activity', 'Entity', 'LocationComponent']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(handler.messages._messages).to.have.lengthOf(2);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
