/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Ship/SellOrderFilled');

describe('Ship::SellOrderFilled Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'SellOrderFilled',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x123',
        '0x0',
        '0x234567890'
      ],
      returnValues: {
        tokenId: 291,
        price: 9468016784
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'Event', 'NftComponent', 'Activity']);
  });

  describe('processEvent', function () {
    let handler;

    beforeEach(async function () {
      await mongoose.model('NftComponent').create({
        entity: { id: 291, label: 3, uuid: '0x1230006' },
        bridge: {},
        price: 9468016784,
        owners: {
          starknet: '0x0000000000000000000000000000000000000000000000000000000123456789'
        }
      });

      handler = new Handler(event);
    });

    it('should update the NftComponent document', async function () {
      await handler.processEvent();

      const nftCompDoc = await mongoose.model('NftComponent').findOne({ entity: { id: 291, label: 6 } });
      expect(nftCompDoc.event.timestamp).to.equal(event.timestamp);
      expect(nftCompDoc.price).to.equal(0);
    });

    it('should create an acitivity document', async function () {
      await handler.processEvent();
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
      expect(acitivityDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should flag the entity for indexing', async function () {
      await handler.processEvent();
      const entityDoc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x1230006' }
      });
      await handler.processEvent();
      expect(entityDoc).to.be.a('object');
    });

    it('should push a message into the messages array', async function () {
      await handler.processEvent();
      expect(handler.messages._messages).to.have.lengthOf(2);
      expect(handler.messages._messages).to.deep.equal([
        { to: 'Ship::291', body: { entities: [Entity.Ship(291)] } },
        {
          to: '0x0000000000000000000000000000000000000000000000000000000123456789',
          body: { entities: [Entity.Ship(291)] }
        }
      ]);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
