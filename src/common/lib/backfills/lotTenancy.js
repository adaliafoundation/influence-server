const mongoose = require('mongoose');
const { hash, shortString } = require('starknet');
const { Permission } = require('@influenceth/sdk');
const { setTimeout: sleep } = require('node:timers/promises');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const { ElasticSearchService } = require('@common/services');

const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
};

// Matches components::resolve and Unique's single storage word in influence-starknet.
const storageKey = (lot) => {
  const path = hash.computePoseidonHashOnElements([shortString.encodeShortString('UseLot'), lot.uuid]);
  const key = hash.computePoseidonHashOnElements([
    shortString.encodeShortString('component'), shortString.encodeShortString('Unique'), path
  ]);
  return `0x${(BigInt(key) % ((2n ** 251n) - 256n)).toString(16)}`;
};

class LotTenancyBackfill {
  constructor({ provider, dispatcher, log = (message) => logger.info(message) }) {
    this.provider = provider;
    this.dispatcher = dispatcher;
    this.log = log;
    this.jobs = mongoose.connection.collection('lot_tenancy_backfills');
    this.lots = mongoose.connection.collection('lot_tenancy_backfill_lots');
  }

  async getJob(job) {
    const state = await this.jobs.findOne({ _id: job });
    if (state && (state.version !== 2 || state.dispatcher !== this.dispatcher)) {
      throw new Error('Job uses a different backfill version or deployment; use a new --job');
    }
    return state;
  }

  async verifyCutoff(state) {
    const block = await this.provider.getBlock(state.blockNumber);
    if (block.blockHash !== state.blockHash || block.status !== 'ACCEPTED_ON_L1') {
      throw new Error('The saved snapshot no longer matches a finalized block');
    }
  }

  async* candidates() {
    const sources = ['PrepaidAgreement', 'ContractAgreement', 'WhitelistAgreement', 'WhitelistAccountAgreement']
      .map((name) => ({
        model: `${name}Component`,
        filter: { 'entity.label': Entity.IDS.LOT, permission: Permission.IDS.USE_LOT },
        field: 'entity'
      }));
    sources.push({ model: 'UseLotComponent', filter: {}, field: 'entity' });
    sources.push({
      model: 'LocationComponent',
      filter: { 'entity.label': Entity.IDS.BUILDING, 'location.label': Entity.IDS.LOT },
      field: 'location'
    });
    for (const { model, filter, field } of sources) {
      const cursor = mongoose.model(model).find(filter).select(field).lean()
        .cursor();
      try {
        for await (const doc of cursor) yield Entity.toEntity(doc[field]);
      } finally {
        await cursor.close();
      }
    }
  }

  async scan({ job, blockNumber, delayMs = 100, dryRun = false }) {
    integer(delayMs, 'delayMs');
    if (blockNumber !== undefined) integer(blockNumber, 'blockNumber');
    let state = await this.getJob(job);
    if (state) {
      if (blockNumber !== undefined && blockNumber !== state.blockNumber) {
        throw new Error('Snapshot block differs from saved job; use a new --job');
      }
      await this.verifyCutoff(state);
    } else {
      const block = await this.provider.getBlock(blockNumber ?? 'l1_accepted');
      integer(block.blockNumber, 'finalized block');
      if (block.status !== 'ACCEPTED_ON_L1' || !block.blockHash) throw new Error('Snapshot must be L1-accepted');
      state = {
        _id: job,
        version: 2,
        dispatcher: this.dispatcher,
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        phase: 'candidates',
        applied: 0,
        skippedNewer: 0
      };
    }
    if (dryRun) {
      const candidates = new Set();
      for await (const lot of this.candidates()) candidates.add(lot.uuid);
      return { dryRun: true, candidates: candidates.size, blockNumber: state.blockNumber };
    }
    if (!await this.getJob(job)) await this.jobs.insertOne(state);
    if (state.phase === 'candidates') {
      await this.lots.createIndex({ job: 1, read: 1, _id: 1 });
      let operations = [];
      for await (const lot of this.candidates()) {
        operations.push({ updateOne: {
          filter: { _id: `${job}:${lot.uuid}` },
          update: { $setOnInsert: { job, entity: lot.toObject(), read: false } },
          upsert: true
        } });
        if (operations.length === 500) {
          await this.lots.bulkWrite(operations);
          operations = [];
        }
      }
      if (operations.length) await this.lots.bulkWrite(operations);
      await this.jobs.updateOne({ _id: job }, { $set: { phase: 'scan' } });
      state.phase = 'scan';
    }
    if (state.phase !== 'scan') return this.status(job);
    this.log(`Reading tenancy at block ${state.blockNumber}, one request at a time, delay ${delayMs}ms`);
    const cursor = this.lots.find({ job, read: false }).sort({ _id: 1 });
    let processed = 0;
    try {
      for await (const row of cursor) {
        const value = await this.provider.getStorageAt(this.dispatcher, storageKey(row.entity), state.blockHash);
        const tenant = BigInt(value) === 0n ? null : Entity.fromUuid(value);
        if (tenant && (!tenant.isCrew() || !tenant.isValid())) throw new Error('Invalid UseLot tenant in storage');
        await this.lots.updateOne({ _id: row._id }, { $set: { tenant: tenant?.toObject() || null, read: true } });
        processed += 1;
        if (processed % 100 === 0) this.log(`Read ${processed} lots this run`);
        if (delayMs) await sleep(delayMs);
      }
    } finally {
      await cursor.close();
    }
    await this.jobs.updateOne({ _id: job }, { $set: { phase: 'ready' } });
    return this.status(job);
  }

  async apply({ job, processorStopped = false, dryRun = false }) {
    if (!dryRun && !processorStopped) throw new Error('Stop the event processor and pass --processorStopped');
    const state = await this.getJob(job);
    if (!state || ['candidates', 'scan'].includes(state.phase)) throw new Error('Complete the scan before applying');
    await this.verifyCutoff(state);
    if (dryRun || state.phase === 'complete') return this.status(job);
    const model = mongoose.model('UseLotComponent');
    await model.createIndexes();
    await this.jobs.updateOne({ _id: job }, { $set: { phase: 'apply' } });
    const cursor = this.lots.find({ job, ...(state.lastLot ? { _id: { $gt: state.lastLot } } : {}) }).sort({ _id: 1 });
    let processed = state.applied + state.skippedNewer;
    try {
      for await (const lot of cursor) {
        const existing = await model.findOne({ 'entity.uuid': lot.entity.uuid }).populate('virtuals.event');
        const event = existing?.virtuals?.event;
        if (existing?.event?.id && !event) throw new Error('Existing tenancy source event is missing');
        const newer = (event?.blockNumber > state.blockNumber) || (existing?.snapshot?.blockNumber > state.blockNumber);
        if (!newer) {
          const data = {
            entity: lot.entity,
            tenant: lot.tenant,
            snapshot: { blockNumber: state.blockNumber, blockHash: state.blockHash }
          };
          if (existing) {
            existing.overwrite(data);
            await existing.save();
          } else {
            await model.create(data);
          }
        }
        await ElasticSearchService.queueEntityForIndexing(lot.entity);
        await this.jobs.updateOne({ _id: job }, {
          $set: { lastLot: lot._id }, $inc: { [newer ? 'skippedNewer' : 'applied']: 1 }
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
    const read = await this.lots.countDocuments({ job, read: true });
    const cleared = await this.lots.countDocuments({ job, read: true, tenant: null });
    return {
      job,
      phase: state.phase,
      blockNumber: state.blockNumber,
      lots: total,
      read,
      assigned: read - cleared,
      cleared,
      applied: state.applied,
      skippedNewer: state.skippedNewer
    };
  }
}

module.exports = LotTenancyBackfill;
