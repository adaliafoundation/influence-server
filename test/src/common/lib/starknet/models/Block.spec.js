const { expect } = require('chai');
const Block = require('@common/lib/starknet/models/Block');
const { PENDING_BLOCK_NUMBER } = require('@common/lib/starknet/models/constants');

describe('Starknet Block model', function () {
  describe('constructor', function () {
    it('should set the blockData', function () {
      const blockData = { block_number: 1, block_hash: '0x123' };
      const block = new Block(blockData);
      expect(block.blockData).to.deep.equal(blockData);
    });
  });

  describe('blockNumber getter', function () {
    it('should return the block number', function () {
      const block = new Block({ block_number: 1 });
      expect(block.blockNumber).to.equal(1);
    });

    it('should return PENDING_BLOCK_NUMBER on pending block', function () {
      const block = new Block();
      expect(block.blockNumber).to.equal(PENDING_BLOCK_NUMBER);
    });
  });

  describe('blockHash getter', function () {
    it('should return the block hash', function () {
      const block = new Block({ block_hash: '0x123' });
      expect(block.blockHash).to.equal('0x123');
    });
  });

  describe('status getter', function () {
    it('should return the status', function () {
      const block = new Block({ status: 'accepted' });
      expect(block.status).to.equal('accepted');
    });

    it('should return pending if no status defined in block data', function () {
      const block = new Block({ });
      expect(block.status).to.equal('PENDING');
    });
  });

  describe('timestamp getter', function () {
    it('should return the accepted time', function () {
      const block = new Block({ accepted_time: 123 });
      expect(block.timestamp).to.equal(123);
    });

    it('should return the timestamp', function () {
      const block = new Block({ timestamp: 123 });
      expect(block.timestamp).to.equal(123);
    });
  });

  describe('transactions getter', function () {
    it('should return the transactions', function () {
      const block = new Block({ transactions: [{ transaction_hash: '0x123' }] });
      expect(block.transactions[0].transaction_hash)
        .to.equal('0x0000000000000000000000000000000000000000000000000000000000000123');
    });
  });

  describe('transactionReceipts getter', function () {
    it('should return the transactionReceipts', function () {
      const block = new Block({
        transaction_receipts: [
          {
            transaction_hash: '0x123',
            events: [{ name: 'foo' }, { name: 'bar' }]
          }
        ]
      });
      expect(block.transactionReceipts[0].transaction_hash);
      expect(block.transactionReceipts[0].events[0].logIndex).to.equal(0);
      expect(block.transactionReceipts[0].events[1].logIndex).to.equal(1);
    });
  });

  describe('getTransactionIndex', function () {
    it('should return the index of the transaction', function () {
      const block = new Block({
        transactions: [{ transaction_hash: '0x123' }, { transaction_hash: '0x456' }]
      });
      expect(block.getTransactionIndex('0x123')).to.equal(0);
      expect(block.getTransactionIndex('0x456')).to.equal(1);
    });
  });

  describe('isAcceptedL1', function () {
    it('should return true if the block is accepted on L1', function () {
      const block = new Block({ status: 'ACCEPTED_ON_L1' });
      expect(block.isAcceptedL1()).to.equal(true);
    });
  });

  describe('isAcceptedL2', function () {
    it('should return true if the block is accepted on L2', function () {
      const block = new Block({ status: 'ACCEPTED_ON_L2' });
      expect(block.isAcceptedL2()).to.equal(true);
    });
  });

  describe('isAborted', function () {
    it('should return true if the block is aborted', function () {
      const block = new Block({ status: 'ABORTED' });
      expect(block.isAborted()).to.equal(true);
    });
  });

  describe('isPending', function () {
    it('should return true if the block is pending', function () {
      const block = new Block({ status: 'PENDING' });
      expect(block.isPending()).to.equal(true);
    });
  });

  describe('isPendingBlockNumber (static)', function () {
    it('should return true if the value is equal to pending', function () {
      expect(Block.isPendingBlockNumber('pending')).to.equal(true);
    });

    it('should return true if the value is equal to PENDING_BLOCK_NUMBER', function () {
      expect(Block.isPendingBlockNumber(Number.MAX_SAFE_INTEGER)).to.equal(true);
    });
  });
});
