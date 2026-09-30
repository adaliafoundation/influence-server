const { expect } = require('chai');
const mongoose = require('mongoose');
const { LocationComponentService } = require('@common/services');
const { SellOrderCancelled: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('SellOrderCancelled Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      data: [
        '0x1', '0x2',
        '0x5', '0x1',
        '0x1',
        '0x2',
        '0x5', '0x2',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'SellOrderCancelled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        sellerCrew: { label: 1, id: 2 },
        exchange: { label: 5, id: 1 },
        product: 1,
        price: 2,
        storage: { label: 5, id: 2 },
        storageSlot: 1,
        callerCrew: { label: 1, id: 1 },
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

    it('should notify the caller crew and both exchange and storage asteroids', async function () {
      const getAsteroid = this._sandbox.stub(LocationComponentService, 'getAsteroidForEntity');
      getAsteroid.withArgs(event.returnValues.exchange).resolves({ label: 3, id: 10 });
      getAsteroid.withArgs(event.returnValues.storage).resolves({ label: 3, id: 20 });
      const handler = new Handler(event);

      await handler.processEvent();

      expect(handler.messages.map(({ to }) => to)).to.have.members(['Crew::1', 'Asteroid::10', 'Asteroid::20']);
    });

    it('should notify a shared asteroid only once', async function () {
      this._sandbox.stub(LocationComponentService, 'getAsteroidForEntity').resolves({ label: 3, id: 10 });
      const handler = new Handler(event);

      await handler.processEvent();

      expect(handler.messages.map(({ to }) => to)).to.have.members(['Crew::1', 'Asteroid::10']);
    });

    it('should still notify the caller crew when asteroid locations are missing', async function () {
      this._sandbox.stub(LocationComponentService, 'getAsteroidForEntity').resolves(null);
      const handler = new Handler(event);

      await handler.processEvent();

      expect(handler.messages.map(({ to }) => to)).to.deep.equal(['Crew::1']);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
