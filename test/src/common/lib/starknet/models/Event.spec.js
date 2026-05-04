const { expect } = require('chai');
const Event = require('@common/lib/starknet/models/Event');
const { PRE_CONFIRMED_BLOCK_NUMBER } = require('@common/lib/starknet/models/constants');

describe('Starknet Event model', function () {
  describe('constructor', function () {
    it('should set the _eventData', function () {
      const eventData = { data: 'data' };
      const event = new Event(eventData);
      expect(event._eventData).to.equal(eventData);
    });
  });

  describe('blockNumber (getter)', function () {
    it('should return the block number (if set)', function () {
      const eventData = { block_number: 1 };
      const event = new Event(eventData);
      expect(event.blockNumber).to.equal(1);
    });

    it('should return the pre_confirmed block number (if empty)', function () {
      const eventData = {};
      const event = new Event(eventData);
      expect(event.blockNumber).to.equal(PRE_CONFIRMED_BLOCK_NUMBER);
    });
  });

  describe('blockHash (getter)', function () {
    it('should return the block hash (if set)', function () {
      const eventData = { block_hash: 'hash' };
      const event = new Event(eventData);
      expect(event.blockHash).to.equal('hash');
    });

    it('should return "PRE_CONFIRMED" (if empty)', function () {
      const eventData = {};
      const event = new Event(eventData);
      expect(event.blockHash).to.equal('PRE_CONFIRMED');
    });
  });

  describe('data (getter)', function () {
    it('should return the data', function () {
      const eventData = { data: 'data' };
      const event = new Event(eventData);
      expect(event.data).to.equal('data');
    });
  });

  describe('fromAddress (getter)', function () {
    it('should return the from address (if set)', function () {
      const eventData = { from_address: '0x123456789' };
      const event = new Event(eventData);
      expect(event.fromAddress).to.equal('0x0000000000000000000000000000000000000000000000000000000123456789');
    });

    it('should return null (if empty)', function () {
      const eventData = {};
      const event = new Event(eventData);
      expect(event.fromAddress).to.equal(null);
    });
  });

  describe('keys (getter)', function () {
    it('should return the keys', function () {
      const eventData = { keys: [1, 2, 3] };
      const event = new Event(eventData);
      expect(event.keys).to.deep.equal([1, 2, 3]);
    });
  });

  describe('logIndex (getter)', function () {
    it('should return the log index', function () {
      const eventData = { logIndex: 1 };
      const event = new Event(eventData);
      expect(event.logIndex).to.equal(1);
    });
  });

  describe('transactionHash (getter)', function () {
    it('should return the transaction hash (if set)', function () {
      const eventData = { transaction_hash: '0x123456789' };
      const event = new Event(eventData);
      expect(event.transactionHash).to.equal('0x0000000000000000000000000000000000000000000000000000000123456789');
    });
  });

  describe('isBlockPreConfirmed', function () {
    it('should return true if the block number is pre_confirmed', function () {
      let event = new Event({});
      expect(event.isBlockPreConfirmed()).to.equal(true);

      event = new Event({ block_number: PRE_CONFIRMED_BLOCK_NUMBER });
      expect(event.isBlockPreConfirmed()).to.equal(true);
    });

    it('should return false if the block number is not pre_confirmed', function () {
      const eventData = { block_number: 1 };
      const event = new Event(eventData);
      expect(event.isBlockPreConfirmed()).to.equal(false);
    });
  });

  describe('toString', function () {
    it('should return a stringified version of the object', function () {
      const eventData = { data: 'data' };
      const event = new Event(eventData);
      expect(event.toString()).to.equal('{"blockNumber":9007199254740991,"blockHash":"PRE_CONFIRMED","data":"data",'
        + '"fromAddress":null,"keys":null,"logIndex":null,"transactionHash":null,"transactionIndex":null}');
    });
  });

  describe('toObject', function () {
    it('should return the object', function () {
      const eventData = {
        block_number: 1,
        block_hash: 'hash',
        data: [1, 2, 3],
        from_address: '0x517567ac7026ce129c950e6e113e437aa3c83716cd61481c6bb8c5057e6923e',
        keys: [1, 2],
        logIndex: 1,
        transaction_hash: '0xac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22'
      };
      const event = new Event(eventData);
      expect(event.toObject()).to.deep.equal({
        blockNumber: eventData.block_number,
        blockHash: eventData.block_hash,
        data: eventData.data,
        fromAddress: '0x0517567ac7026ce129c950e6e113e437aa3c83716cd61481c6bb8c5057e6923e',
        keys: eventData.keys,
        logIndex: eventData.logIndex,
        transactionHash: '0x00ac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22',
        transactionIndex: null
      });
    });
  });
});
