const mongoose = require('mongoose');

const LOCAL_ID_OFFSET = 100_000_000; // avoid colliding with on-chain IDs

class IdGenerator {
  /**
   * Returns the next unique ID for the given entity label.
   * Uses MongoDB findOneAndUpdate for atomic increment — safe under concurrency.
   *
   * @param {number} entityLabel - e.g. Entity.IDS.BUILDING
   * @returns {Promise<number>} unique ID starting above LOCAL_ID_OFFSET
   */
  static async next(entityLabel) {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findOneAndUpdate(
      { key: `entity_${entityLabel}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    return LOCAL_ID_OFFSET + counter.seq;
  }
}

module.exports = IdGenerator;
