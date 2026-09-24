const mongoose = require('mongoose');
const { orderBy } = require('lodash');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const { ComponentService, ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Unique');

const integer = (value, name, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
};

class LotTenancyBackfill {
  constructor({ provider, addresses, dispatcher, originBlock, log = (message) => logger.info(message) }) {
    this.provider = provider;
    this.addresses = addresses;
    this.dispatcher = dispatcher;
    this.originBlock = originBlock;
    this.log = log;
    this.jobs = mongoose.connection.collection('lot_tenancy_backfills');
    this.lots = mongoose.connection.collection('lot_tenancy_backfill_lots');
  }

  async getJob(job) {
    const state = await this.jobs.findOne({ _id: job });
    if (state && (state.dispatcher !== this.dispatcher
      || JSON.stringify(state.addresses) !== JSON.stringify(this.addresses))) {
      throw new Error('Job contract configuration differs from this deployment; use a different --job');
    }
    return state;
  }

  async verifyCutoff(state) {
    const block = await this.provider.getBlock(state.toBlock);
    if (block.blockHash !== state.blockHash || block.status !== 'ACCEPTED_ON_L1') {
      throw new Error('The saved cutoff no longer matches a finalized block');
    }
  }

  async scan({ job, fromBlock, toBlock, batchSize = 1000, dryRun = false }) {
    integer(batchSize, 'batchSize', 1);
    let state = await this.getJob(job);
    if (state) {
      if ((fromBlock !== undefined && fromBlock !== state.fromBlock)
        || (toBlock !== undefined && toBlock !== state.toBlock)) {
        throw new Error('Block bounds differ from saved job; use a different --job');
      }
      await this.verifyCutoff(state);
      if (state.phase !== 'scan') return this.status(job);
    } else {
      const start = fromBlock ?? this.originBlock;
      integer(start, 'fromBlock');
      if (toBlock !== undefined) integer(toBlock, 'toBlock');
      const block = await this.provider.getBlock(toBlock ?? 'l1_accepted');
      integer(block.blockNumber, 'finalized block');
      if (block.status !== 'ACCEPTED_ON_L1' || !block.blockHash || block.blockNumber < start) {
        throw new Error('Cutoff must be a finalized block at or after fromBlock');
      }
      state = {
        _id: job,
        dispatcher: this.dispatcher,
        addresses: this.addresses,
        fromBlock: start,
        toBlock: block.blockNumber,
        blockHash: block.blockHash,
        nextBlock: start,
        phase: 'scan',
        applied: 0,
        skippedNewer: 0
      };
      if (!dryRun) {
        await this.lots.createIndex({ job: 1, _id: 1 });
        await this.jobs.insertOne(state);
      }
    }

    this.log(`Scan ${job}: blocks ${state.nextBlock}-${state.toBlock}${dryRun ? ' (dry run)' : ''}`);
    let matched = 0;
    for (let start = state.nextBlock; start <= state.toBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, state.toBlock);
      // Use the same address set as the live retriever to preserve its event indices.
      const events = await this.provider.getEvents({ addresses: this.addresses, fromBlock: start, toBlock: end });
      const latest = new Map();
      for (const event of orderBy(events, ['blockNumber', 'transactionIndex', 'logIndex'])) {
        if (BigInt(event.address) !== BigInt(this.dispatcher)
          || event.keys.length !== Handler.eventConfig.keys.length
          || !event.keys.every((key, i) => BigInt(key) === BigInt(Handler.eventConfig.keys[i]))) {
          continue; // eslint-disable-line no-continue
        }
        const parsed = Handler.parseEvent(event);
        if (!parsed.returnValues.entity) continue; // eslint-disable-line no-continue
        const lot = Entity.toEntity(parsed.returnValues.entity);
        if (!lot.isLot()) throw new Error('UseLot path does not identify a lot');
        matched += 1;
        latest.set(lot.uuid, parsed);
      }
      if (!dryRun) {
        if (latest.size) {
          await this.lots.bulkWrite([...latest].map(([uuid, event]) => ({
            replaceOne: {
              filter: { _id: `${job}:${uuid}` },
              replacement: { _id: `${job}:${uuid}`, job, event },
              upsert: true
            }
          })));
        }
        await this.jobs.updateOne({ _id: job }, { $set: { nextBlock: end + 1 } });
      }
      this.log(`Scanned through ${end}; ${matched} tenancy updates this run`);
    }
    if (dryRun) return { dryRun: true, matched, fromBlock: state.nextBlock, toBlock: state.toBlock };
    await this.jobs.updateOne({ _id: job }, { $set: { phase: 'ready' } });
    return this.status(job);
  }

  async apply({ job, processorStopped = false, dryRun = false }) {
    if (!dryRun && !processorStopped) throw new Error('Stop the event processor and pass --processorStopped');
    const state = await this.getJob(job);
    if (!state || state.phase === 'scan') throw new Error('Complete the scan before applying');
    await this.verifyCutoff(state);
    if (dryRun || state.phase === 'complete') return this.status(job);

    // Production disables automatic index creation.
    await mongoose.model('UseLotComponent').createIndexes();
    await this.jobs.updateOne({ _id: job }, { $set: { phase: 'apply' } });
    const cursor = this.lots.find({ job, ...(state.lastLot ? { _id: { $gt: state.lastLot } } : {}) }).sort({ _id: 1 });
    let processed = state.applied + state.skippedNewer;
    this.log(`Apply ${job}: resuming after ${processed} lots`);
    try {
      for await (const lot of cursor) {
        const parsed = lot.event;
        const identity = {
          event: parsed.event,
          transactionHash: parsed.transactionHash,
          logIndex: parsed.logIndex,
          removed: false
        };
        const existing = await mongoose.model('Starknet').findOne(identity);
        if (existing && existing.blockHash !== parsed.blockHash) throw new Error('Stored source event block mismatch');
        const event = await mongoose.model('Starknet').findOneAndUpdate(identity, {
          $set: parsed,
          $setOnInsert: { lastProcessed: new Date() }
        }, { upsert: true, new: true, runValidators: true });
        const result = await ComponentService.updateOrCreateFromEvent({
          component: 'UseLot', event, data: parsed.returnValues, replace: true
        });
        // Also enqueue on a resumed write: a previous attempt may have stopped before indexing.
        await ElasticSearchService.queueEntityForIndexing(parsed.returnValues.entity);
        event.lastProcessed = new Date();
        await event.save();
        await this.jobs.updateOne({ _id: job }, {
          $set: { lastLot: lot._id },
          $inc: { [result.updated ? 'applied' : 'skippedNewer']: 1 }
        });
        processed += 1;
        if (processed % 1000 === 0) this.log(`Applied/checked ${processed} lots`);
      }
    } finally {
      await cursor.close();
    }
    await this.jobs.updateOne({ _id: job }, { $set: { phase: 'complete' } });
    return this.status(job);
  }

  async status(job) {
    const state = await this.getJob(job);
    if (!state) throw new Error('Job not found; run scan first');
    const total = await this.lots.countDocuments({ job });
    const cleared = await this.lots.countDocuments({ job, 'event.returnValues.tenant': null });
    return {
      job,
      phase: state.phase,
      fromBlock: state.fromBlock,
      toBlock: state.toBlock,
      nextBlock: state.nextBlock,
      lots: total,
      assigned: total - cleared,
      cleared,
      applied: state.applied,
      skippedNewer: state.skippedNewer
    };
  }
}

module.exports = LotTenancyBackfill;
