const mongoose = require('mongoose');

class StarknetReconciliationBlockService {
  static modelName = 'StarknetReconciliationBlock';

  static normalizeBlocks(blocks = []) {
    const deduped = {};
    blocks.forEach((block) => {
      const blockNumber = Number(block?.blockNumber);
      if (!Number.isFinite(blockNumber)) return;
      if (!block?.blockHash || !block?.status) return;

      deduped[blockNumber.toString()] = {
        blockNumber,
        blockHash: block.blockHash,
        status: block.status
      };
    });

    return Object.values(deduped);
  }

  static upsertMany(blocks = []) {
    const normalized = this.normalizeBlocks(blocks);
    if (normalized.length === 0) return null;

    const actions = normalized.map((block) => ({
      updateOne: {
        filter: { blockNumber: block.blockNumber },
        update: {
          blockHash: block.blockHash,
          status: block.status
        },
        upsert: true
      }
    }));

    return mongoose.model(this.modelName).bulkWrite(actions, { ordered: false });
  }

  static upsertOne(block) {
    return this.upsertMany([block]);
  }

  static deleteByBlockNumbers(blockNumbers = []) {
    const normalized = [...new Set(blockNumbers.map(Number).filter(Number.isFinite))];
    if (normalized.length === 0) return null;
    return mongoose.model(this.modelName).deleteMany({ blockNumber: { $in: normalized } });
  }

  static deleteFromBlock(fromBlock) {
    const parsedFromBlock = Number(fromBlock);
    if (!Number.isFinite(parsedFromBlock)) throw new Error(`Invalid fromBlock: ${fromBlock}`);
    return mongoose.model(this.modelName).deleteMany({ blockNumber: { $gte: parsedFromBlock } });
  }

  static pruneAcceptedOnL1OlderThan(minBlockNumber) {
    const parsedMinBlockNumber = Number(minBlockNumber);
    if (!Number.isFinite(parsedMinBlockNumber)) return null;
    return mongoose.model(this.modelName).deleteMany({
      status: 'ACCEPTED_ON_L1',
      blockNumber: { $lt: parsedMinBlockNumber }
    });
  }

  static getTrackedBlocks({ headBlock, retentionBlocks, limit }) {
    const parsedHeadBlock = Number(headBlock);
    const parsedRetentionBlocks = Number(retentionBlocks);
    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedHeadBlock)) throw new Error(`Invalid headBlock: ${headBlock}`);
    if (!Number.isFinite(parsedRetentionBlocks) || parsedRetentionBlocks < 0) {
      throw new Error(`Invalid retentionBlocks: ${retentionBlocks}`);
    }
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) throw new Error(`Invalid limit: ${limit}`);

    const minRetainedL1Block = parsedHeadBlock - parsedRetentionBlocks;
    return mongoose.model(this.modelName)
      .find({
        $or: [
          { status: { $ne: 'ACCEPTED_ON_L1' } },
          { blockNumber: { $gte: minRetainedL1Block } }
        ]
      })
      .sort({ blockNumber: 1 })
      .limit(parsedLimit)
      .lean();
  }
}

module.exports = StarknetReconciliationBlockService;
