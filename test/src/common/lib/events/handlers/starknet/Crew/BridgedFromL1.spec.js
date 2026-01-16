const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Crew/BridgedFromL1');

describe('Crew::BridgedFromL1 Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'BridgedFromL1',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x0',
        '0x123456789'
      ],
      returnValues: {
        tokenId: 1,
        toAddress: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'Event', 'NftComponent', 'Activity', 'Crossing', 'IndexItem']);
  });

  describe('processEvent', function () {
    let handler;

    beforeEach(async function () {
      await mongoose.model('Crossing').create({
        assetIds: [1],
        assetIdsKey: 'Crew:1',
        assetType: 'Crew',
        destination: 'STARKNET',
        destinationBridge: '0x1',
        fromAddress: '0x0000000000000000000000000000000012345678',
        origin: 'ETHEREUM',
        originBridge: '0x1',
        status: 'PROCESSING',
        toAddress: '0x0000000000000000000000000000000000000000000000000000000123456789'
      });

      handler = new Handler(event);
    });

    it('should create a NftComponent document (if not found)', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('NftComponent').findOne({ 'entity.uuid': Entity.Crew(1).uuid });
      expect(doc).to.be.an('object');
      expect(doc.owners.starknet).to.equal(event.returnValues.toAddress);
      expect(doc.bridge).to.deep.include({ destination: 'STARKNET', origin: 'ETHEREUM', status: 'COMPLETE' });
    });

    it('should update the NftComponent document, if current event is newer', async function () {
      await handler.processEvent();

      // bump the timestamp to simulate a newer event
      handler.eventDoc.timestamp = event.timestamp + 1;
      await handler.processEvent();

      const nftCompDoc = await mongoose.model('NftComponent').findOne({ 'entity.uuid': Entity.Crew(1).uuid });
      expect(nftCompDoc).to.be.an('object');
      expect(nftCompDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should create an acitivity document', async function () {
      await handler.processEvent();
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
    });

    it('should flag the entity for indexing', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10001' }
      });
      expect(doc).to.be.an('object');
    });

    it('should push a message into the messages array', async function () {
      await handler.processEvent();
      expect(handler.messages._messages).to.have.lengthOf(1);
      expect(handler.messages._messages).to.deep.equal([{ to: 'Crew::1' }]);
    });

    it('should remove the crossing document', async function () {
      await handler.processEvent();
      const crossingDocs = await mongoose.model('Crossing').find({});
      expect(crossingDocs.length).to.equal(0);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
