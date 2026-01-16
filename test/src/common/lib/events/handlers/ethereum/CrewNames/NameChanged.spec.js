const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/ethereum/CrewNames/NameChanged');

describe('CrewNames::NameChanged', function () {
  let event;

  before(function () {
    event = mongoose.model('Ethereum')({
      transactionHash: '0x123',
      blockNumber: 123,
      logIndex: 0,
      event: 'NameChanged',
      timestamp: 1,
      transactionIndex: 1,
      returnValues: {
        crewId: 1,
        newName: 'Crewmate 1'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'Event', 'IndexItem', 'NameComponent']);
  });

  describe('processEvent', function () {
    it('should create a NameComponent document if it does not exist', async function () {
      await (new Handler(event)).processEvent();
      const nameCompDoc = await mongoose.model('NameComponent').findOne({ entity: { id: 1, label: 2 } });
      expect(nameCompDoc.name).to.equal('Crewmate 1');
    });

    it('should update a NameComponent document if it exists', async function () {
      await (new Handler(event)).processEvent();

      // Update event values so that the Name Component doc will be updated
      event.returnValues.newName = 'Crewmate 2';
      event.timestamp = 2;
      await (new Handler(event)).processEvent();

      const nameCompDoc = await mongoose.model('NameComponent').findOne({ entity: { id: 1, label: 2 } });
      expect(nameCompDoc.name).to.equal('Crewmate 2');
      expect(nameCompDoc.event.timestamp).to.equal(2);
    });

    it('should create an Activity document', async function () {
      await (new Handler(event)).processEvent();
      const activityDoc = await mongoose.model('Activity').findOne({ 'event.id': event._id });
      expect(activityDoc.toJSON().entities).to.deep.include(Entity.Crewmate(1));
    });

    it('should flag the entity for reindexing', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10002' }
      });
      expect(doc).to.be.an('object');
    });
  });
});
