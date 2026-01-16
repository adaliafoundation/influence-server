const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionDeconstructed');

describe('ConstructionDeconstructed Handler', function () {
  let event;
  let updateSub;

  beforeEach(async function () {
    await mongoose.model('LocationComponent').create({
      entity: Entity.Building(1),
      location: Entity.lotFromIndex(1, 1)
    });

    updateSub = this._sandbox.stub(PackedLotDataService, 'update').resolves();

    event = mongoose.model('Starknet')({
      data: [
        '0x5', '0x01',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'ConstructionDeconstructed',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        building: { label: 5, id: 1 },
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
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

    it('should update the packed lot data', async function () {
      await (new Handler(event)).processEvent();
      expect(updateSub.calledOnceWith({ ...Entity.Lot(4294967297) })).to.eql(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
