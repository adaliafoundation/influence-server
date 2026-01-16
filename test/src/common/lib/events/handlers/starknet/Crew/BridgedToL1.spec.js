const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Asteroid/BridgedToL1');

describe('Asteroid::BridgedToL1 Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'BridgedToL1',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x0',
        '0x123456789',
        '0x12345678'
      ],
      returnValues: {
        tokenId: 1,
        fromAddress: '0x0000000000000000000000000000000000000000000000000000000123456789',
        toAddress: '0x0000000000000000000000000000000012345678'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'Event', 'NftComponent', 'Activity', 'Crossing', 'IndexItem']);
  });

  describe('processEvent', function () {
    it('should create a NftComponent document (if not found)', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 3 } });
      expect(doc).to.be.an('object');
      expect(doc.owners.ethereum).to.equal(event.returnValues.toAddress);
      expect(doc.owners.starknet).to.equal(event.returnValues.fromAddress);
      expect(doc.bridge).to.deep.include({ destination: 'ETHEREUM', origin: 'STARKNET', status: 'PROCESSING' });
    });

    it('should update the NftComponent document, if current event is newer', async function () {
      const handler = new Handler(event);
      await handler.processEvent();

      // bump the timestamp to simulate a newer event
      handler.eventDoc.timestamp = event.timestamp + 1;
      await handler.processEvent();

      const nftCompDoc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 3 } });
      expect(nftCompDoc).to.be.an('object');
      expect(nftCompDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should create an acitivity document', async function () {
      await (new Handler(event)).processEvent();
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
    });

    it('should flag the entity for indexing', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10003' }
      });
      expect(doc).to.be.an('object');
    });

    it('should push a message into the messages array', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      expect(handler.messages._messages).to.have.lengthOf(1);
      expect(handler.messages._messages).to.deep.equal([{ to: 'Asteroid::1' }]);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
