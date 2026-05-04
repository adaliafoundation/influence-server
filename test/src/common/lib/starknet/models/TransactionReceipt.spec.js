const { expect } = require('chai');
const TransactionReceipt = require('@common/lib/starknet/models/TransactionReceipt');
const { PRE_CONFIRMED_BLOCK_NUMBER } = require('@common/lib/starknet/models/constants');

describe('Starknet TransactionReceipt model', function () {
  describe('constructor', function () {
    it('should set the _transactionReceiptData', function () {
      const transactionReceiptData = { block_number: 1 };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt._transactionReceiptData).to.equal(transactionReceiptData);
    });
  });

  describe('blockNumber (getter)', function () {
    it('should return the block number (if set)', function () {
      const transactionReceiptData = { block_number: 1 };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.blockNumber).to.equal(1);
    });

    it('should return the pre_confirmed block number (if empty)', function () {
      const transactionReceiptData = {};
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.blockNumber).to.equal(PRE_CONFIRMED_BLOCK_NUMBER);
    });
  });

  describe('blockHash (getter)', function () {
    it('should return the block hash (if set)', function () {
      const transactionReceiptData = { block_hash: 'hash' };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.blockHash).to.equal('hash');
    });

    it('should return "PRE_CONFIRMED" (if empty)', function () {
      const transactionReceiptData = {};
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.blockHash).to.equal('PRE_CONFIRMED');
    });
  });

  describe('transactionHash (getter)', function () {
    it('should return the transaction hash', function () {
      const transactionReceiptData = {
        transaction_hash: '0xac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22'
      };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.transactionHash).to
        .equal('0x00ac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22');
    });
  });

  describe('transactionIndex (getter)', function () {
    it('should return the transaction index', function () {
      const transactionReceiptData = { transaction_index: 1 };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.transactionIndex).to.equal(1);
    });
  });

  describe('isBlockPreConfirmed', function () {
    it('should return true if the block number is pre_confirmed', function () {
      let transactionReceipt = new TransactionReceipt({});
      expect(transactionReceipt.isBlockPreConfirmed()).to.equal(true);

      transactionReceipt = new TransactionReceipt({ block_number: PRE_CONFIRMED_BLOCK_NUMBER });
      expect(transactionReceipt.isBlockPreConfirmed()).to.equal(true);
    });

    it('should return false if the block number is not pre_confirmed', function () {
      const transactionReceiptData = { block_number: 1 };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.isBlockPreConfirmed()).to.equal(false);
    });
  });

  describe('events (getter)', function () {
    it('should return the events', function () {
      const transactionReceiptData = {
        events: [{ data: [] }],
        transaction_hash: '0xac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22'
      };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.events[0]._eventData).to.deep.equal({
        data: [],
        logIndex: 0,
        transaction_hash: '0x00ac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22'
      });
    });
  });

  describe('getEventsByAddress', function () {
    it('should return the events by address', function () {
      const transactionReceiptData = {
        events: [
          { from_address: '0x123456789' },
          { from_address: '0x987654321' },
          { from_address: '0x123456789' }
        ],
        transaction_hash: '0xac3dcc7c733ba73e19b5fd262533a12607748a174c9af5c7c28a6e84263e22'
      };
      const transactionReceipt = new TransactionReceipt(transactionReceiptData);
      expect(transactionReceipt.getEventsByAddress('0x123456789').length).to.equal(2);
      expect(transactionReceipt.getEventsByAddress('0x987654321').length).to.equal(1);
    });
  });
});
