const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Location');

describe('ComponentUpdated: Location Handler', function () {
  let event;

  beforeEach(async function () {
    await mongoose.model('LocationComponent').create({
      entity: Entity.Building(1),
      location: Entity.Lot(6881662889623553)
    });
    event = mongoose.model('Starknet')({
      blockNumber: 1,
      transactionHash: '0x1',
      logIndex: 1,
      timestamp: 1,
      event: 'ComponentUpdated_Location',
      data: ['0x1', '0x10006', '0x5', '0x1'],
      returnValues: {
        entity: { label: 6, id: 1 },
        location: { label: 5, id: 1 }
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'LocationComponent', 'IndexItem']);
  });

  describe('processEvent', function () {
    it('should calculate and set the full location', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('LocationComponent').findOne({ 'entity.uuid': Entity.Building(1).uuid });
      expect(doc.toJSON().locations).to.deep.eql([
        { id: 6881662889623553, label: 4, uuid: '0x1872d6000000010004' },
        { id: 1, label: 3, uuid: '0x10003' }
      ]);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.eql(event.returnValues);
    });
  });
});
