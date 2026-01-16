const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const { ActivityService } = require('@common/services');
const {
  SurfaceScanFinished: Handler,
  SurfaceScanStarted } = require('@common/lib/events/handlers/starknet/Dispatcher');

describe('SurfaceScanFinished Handler', function () {
  let endEvent;
  let startEvent;

  beforeEach(function () {
    startEvent = mongoose.model('Starknet')({
      event: 'SurfaceScanStarted',
      name: 'SurfaceScanStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        asteroid: { id: 1, label: 3 },
        finishTime: 1695691834,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    endEvent = mongoose.model('Starknet')({
      data: [
        '0x3', '0x1',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'SurfaceScanFinished',
      logIndex: 2,
      timestamp: 1695691835,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        asteroid: { id: 1, label: 3 },
        bonuses: 1,
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
        hashKeys: SurfaceScanStarted.hashKeys,
        unresolvedFor: [startEvent.returnValues.callerCrew]
      });

      const handler = new Handler(endEvent);
      await handler.processEvent();
      const startActivityDoc = await mongoose.model('Activity').findById(doc._id);
      expect(startActivityDoc.unresolvedFor).to.equal(null);
    });

    it('should update the marketplace(s)', async function () {
      const openSeaStub = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
      const unframedStub = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
      const handler = new Handler(endEvent);
      await handler.processEvent();
      expect(openSeaStub.calledOnce).to.equal(true);
      expect(unframedStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(endEvent)).to.deep.equal(endEvent.returnValues);
    });
  });
});
