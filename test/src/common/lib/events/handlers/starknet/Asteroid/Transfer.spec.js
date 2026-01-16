/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Asteroid/Transfer');

describe('Starknet::Asteroid::Transfer Handler', function () {
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
        '0x2',
        '0x0'
      ],
      returnValues: {
        from: '0x0000000000000000000000000000000000000000000000000000000000000000',
        to: '0x0000000000000000000000000000000000000000000000000000000123456789',
        tokenId: 2
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'Event', 'NftComponent', 'Activity', 'IndexItem']);
  });

  describe('processEvent', function () {
    let handler;
    beforeEach(async function () {
      handler = new Handler(event);
      await handler.processEvent();
    });

    it('should create a NftComponent document', async function () {
      const doc = await mongoose.model('NftComponent').findOne({ entity: { id: 2, label: 3 } });
      expect(doc).to.be.an('object');
    });

    it('should create an acitivity document', async function () {
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
    });

    it('should flag the entity for indexing', async function () {
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x20003' }
      });
      expect(doc).to.be.an('object');
    });

    it('should push a message into the messages array', async function () {
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
