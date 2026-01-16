const { expect } = require('chai');
const BaseHandler = require('@common/lib/events/handlers/BaseHandler');
const { StarknetEventFactory } = require('../../../../../factories');

describe('Event BaseHandler', function () {
  let starknetEvent;

  beforeEach(async function () {
    starknetEvent = await StarknetEventFactory.createOne();
  });

  afterEach(async function () {
    await StarknetEventFactory.purge();
  });

  describe('finalizeEvent', function () {
    it('should set lastProcessed and save the event document', async function () {
      const handler = new BaseHandler(starknetEvent);
      await handler.finalizeEvent();

      expect(starknetEvent.lastProcessed).to.be.lte(new Date());
    });
  });

  describe('getRoomFromEntity', function () {
    it('should return a room name from an entity', function () {
      const handler = new BaseHandler({ name: 'foo' });
      expect(handler.getRoomFromEntity({ label: 1, id: '123' })).to.equal('Crew::123');
      expect(handler.getRoomFromEntity({ label: 2, id: '123' })).to.equal('Crewmate::123');
      expect(handler.getRoomFromEntity({ label: 3, id: '123' })).to.equal('Asteroid::123');
      expect(handler.getRoomFromEntity({ label: 4, id: '123' })).to.equal('Lot::123');
      expect(handler.getRoomFromEntity({ label: 5, id: '123' })).to.equal('Building::123');
      expect(handler.getRoomFromEntity({ label: 6, id: '123' })).to.equal('Ship::123');
      expect(handler.getRoomFromEntity({ label: 7, id: '123' })).to.equal('Deposit::123');
      expect(handler.getRoomFromEntity({ label: 9, id: '123' })).to.equal('Delivery::123');
      expect(handler.getRoomFromEntity({ label: 10, id: '123' })).to.equal('Space::123');
    });

    it('should throw an error if the entity label is not found', function () {
      const handler = new BaseHandler({ name: 'foo' });
      expect(() => handler.getRoomFromEntity({ label: 42, id: '123' })).to.throw('Entity label not found');
    });
  });
});
