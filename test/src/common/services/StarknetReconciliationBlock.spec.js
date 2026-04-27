const { expect } = require('chai');
const mongoose = require('mongoose');
const StarknetReconciliationBlockService = require('@common/services/StarknetReconciliationBlock');

describe('StarknetReconciliationBlockService', function () {
  const model = () => mongoose.model('StarknetReconciliationBlock');

  afterEach(async function () {
    await model().deleteMany({});
  });

  it('should upsert blocks atomically by blockNumber', async function () {
    await StarknetReconciliationBlockService.upsertMany([
      { blockNumber: 12, blockHash: '0xaaa', status: 'ACCEPTED_ON_L2' },
      { blockNumber: 12, blockHash: '0xbbb', status: 'ACCEPTED_ON_L1' },
      { blockNumber: 13, blockHash: '0xccc', status: 'ACCEPTED_ON_L2' }
    ]);

    const docs = await model().find({}).sort({ blockNumber: 1 }).lean();
    expect(docs).to.have.lengthOf(2);
    expect(docs[0].blockNumber).to.eql(12);
    expect(docs[0].blockHash).to.eql('0xbbb');
    expect(docs[0].status).to.eql('ACCEPTED_ON_L1');
    expect(docs[1].blockNumber).to.eql(13);
  });

  it('should prune old l1 blocks and only fetch tracked candidates within policy', async function () {
    await model().insertMany([
      { blockNumber: 2, blockHash: '0x2', status: 'ACCEPTED_ON_L1' },
      { blockNumber: 4, blockHash: '0x4', status: 'ACCEPTED_ON_L2' },
      { blockNumber: 6, blockHash: '0x6', status: 'ACCEPTED_ON_L1' },
      { blockNumber: 8, blockHash: '0x8', status: 'ACCEPTED_ON_L2' }
    ]);

    await StarknetReconciliationBlockService.pruneAcceptedOnL1OlderThan(5);
    const tracked = await StarknetReconciliationBlockService.getTrackedBlocks({
      headBlock: 10,
      retentionBlocks: 5,
      limit: 10
    });

    expect(tracked.map((doc) => doc.blockNumber)).to.eql([4, 6, 8]);
  });

  it('should delete all tracked rows from the specified block', async function () {
    await model().insertMany([
      { blockNumber: 10, blockHash: '0xa', status: 'ACCEPTED_ON_L2' },
      { blockNumber: 11, blockHash: '0xb', status: 'ACCEPTED_ON_L1' },
      { blockNumber: 12, blockHash: '0xc', status: 'ACCEPTED_ON_L2' }
    ]);

    await StarknetReconciliationBlockService.deleteFromBlock(11);

    const docs = await model().find({}).sort({ blockNumber: 1 }).lean();
    expect(docs.map((doc) => doc.blockNumber)).to.eql([10]);
  });

  it('should expose indexes for uniqueness and reconciliation scans', async function () {
    await model().syncIndexes();
    const indexes = await model().collection.indexes();
    const indexNames = indexes.map((index) => index.name);

    expect(indexNames).to.include('starknet_reconciliation_block_number_unique');
    expect(indexNames).to.include('starknet_reconciliation_status_block');
  });
});
