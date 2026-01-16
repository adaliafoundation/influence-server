/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Crew/Transfer');

describe('Starknet::Crew::Transfer Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'Transfer',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x0',
        '0x123456789',
        '0x1',
        '0x0'
      ],
      returnValues: {
        from: '0x0000000000000000000000000000000000000000000000000000000000000000',
        to: '0x0000000000000000000000000000000000000000000000000000000123456789',
        tokenId: 1
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'Event', 'NftComponent', 'Activity', 'IndexItem']);
  });

  describe('processEvent', function () {
    let handler;

    beforeEach(function () {
      handler = new Handler(event);
    });

    it('should create a NftComponent document', async function () {
      await handler.processEvent(event);
      const doc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 1 } });
      expect(doc).to.be.an('object');
      expect(doc.owners.starknet).to.equal(event.returnValues.to);
    });

    it('should update the NftComponent document, if current event is newer', async function () {
      await handler.processEvent(event);

      // bump the timestamp to simulate a newer event
      handler.eventDoc.timestamp = event.timestamp + 1;
      await handler.processEvent();

      const nftCompDoc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 1 } });
      expect(nftCompDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should create an acitivity document', async function () {
      await handler.processEvent(event);
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
      expect(acitivityDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should flag the entity for indexing', async function () {
      await handler.processEvent(event);
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10001' }
      });
      expect(doc).to.be.an('object');
    });

    it('should push a message into the messages array', async function () {
      await handler.processEvent(event);
      expect(handler.messages._messages).to.have.lengthOf(3);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
