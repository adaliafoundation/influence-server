#!/usr/bin/env node

/**
 * Restores a database dump created by bin/dump.js.
 *
 * Drops existing collections, inserts all documents from the dump file,
 * clears the block cache (keyv collection) so the server resumes syncing
 * from the latest ACCEPTED_ON_L1 event in the restored data, and rebuilds
 * all Mongoose indexes.
 *
 * Usage:
 *   node bin/restore.js --input <dump-file> [options]
 *
 * Options:
 *   --input, -i     Input dump file path (required)
 *   --force, -f     Skip confirmation prompt
 */
require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');

const fs = require('fs');
const { createGunzip } = require('zlib');
const readline = require('readline');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const prompt = require('prompt');
const { StarknetBlockCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');

const args = yargs(hideBin(process.argv))
  .option('input', {
    alias: 'i',
    type: 'string',
    description: 'Input dump file path',
    demandOption: true
  })
  .option('force', {
    alias: 'f',
    type: 'boolean',
    description: 'Skip confirmation prompt',
    default: false
  })
  .help()
  .parse();

const BATCH_SIZE = 1000;

/**
 * Read just the __meta line from a dump file (first line).
 */
async function readMeta(inputPath) {
  const isGzipped = inputPath.endsWith('.gz');
  const fileStream = fs.createReadStream(inputPath);
  const input = isGzipped ? fileStream.pipe(createGunzip()) : fileStream;
  const rl = readline.createInterface({ input, croppingThreshold: 0 });

  for await (const line of rl) {
    const obj = JSON.parse(line);
    if (obj.__meta) {
      rl.close();
      input.destroy();
      return obj.__meta;
    }
    break;
  }
  throw new Error('Dump file does not contain a __meta header line');
}

/**
 * Scan the dump file and return an array of { collection, count } entries.
 */
async function scanCollections(inputPath) {
  const isGzipped = inputPath.endsWith('.gz');
  const fileStream = fs.createReadStream(inputPath);
  const input = isGzipped ? fileStream.pipe(createGunzip()) : fileStream;
  const rl = readline.createInterface({ input, croppingThreshold: 0 });

  const collections = [];
  for await (const line of rl) {
    const obj = JSON.parse(line);
    if (obj.__collection) {
      collections.push({ collection: obj.__collection, modelName: obj.modelName, count: obj.count });
    }
  }
  return collections;
}

/**
 * Confirm with the user before proceeding.
 */
async function confirmRestore(meta, collections) {
  logger.info('--- Dump Info ---');
  logger.info(`  Generated: ${meta.generatedAt}`);
  logger.info(`  Starknet block: ${meta.starknetBlock}`);
  logger.info(`  Event days: ${meta.eventDays}`);
  logger.info(`  Format version: ${meta.version}`);
  logger.info('');
  logger.info('Collections to restore:');
  for (const { collection, count } of collections) {
    logger.info(`  ${collection}: ${count} docs`);
  }
  logger.info('');
  logger.info('WARNING: This will DROP the above collections and the keyv cache, then insert the dump data.');

  prompt.start();
  const { response } = await prompt.get([{
    name: 'response',
    description: 'Proceed? (y/n)',
    required: true,
    type: 'string',
    pattern: /^[yn]$/i
  }]);

  return response.toLowerCase() === 'y';
}

/**
 * Insert a batch of documents into a MongoDB collection.
 */
async function insertBatch(collection, batch) {
  if (batch.length === 0) return;
  // Deserialize EJSON to restore BSON types (ObjectId, Date, etc.)
  const docs = batch.map((line) => EJSON.deserialize(JSON.parse(line)));
  try {
    await collection.insertMany(docs, { ordered: false });
  } catch (err) {
    // Duplicate key errors can happen if dump has overlapping data; log and continue
    if (err.code === 11000) {
      logger.warn(`  Duplicate key(s) in batch, ${err.result?.nInserted || '?'} inserted`);
    } else {
      throw err;
    }
  }
}

const main = async () => {
  const inputPath = args.input;
  if (!fs.existsSync(inputPath)) {
    logger.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  // Wait for DB connection
  await new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
    return undefined;
  });

  // Read metadata and scan collections
  const meta = await readMeta(inputPath);
  const collections = await scanCollections(inputPath);

  if (!args.force) {
    const confirmed = await confirmRestore(meta, collections);
    if (!confirmed) {
      logger.info('Cancelled.');
      process.exit(0);
    }
  } else {
    logger.info(`Restoring from: ${inputPath}`);
    logger.info(`  Generated: ${meta.generatedAt}`);
    logger.info(`  Starknet block: ${meta.starknetBlock}`);
    logger.info(`  Collections: ${collections.length}`);
  }

  const db = mongoose.connection.db;

  // 1. Clear the keyv cache (Starknet/Ethereum block tracking)
  logger.info('Clearing keyv cache...');
  try {
    await db.dropCollection('keyv');
    logger.info('  keyv collection dropped');
  } catch (err) {
    if (err.codeName === 'NamespaceNotFound') {
      logger.info('  keyv collection not found (already clean)');
    } else {
      throw err;
    }
  }

  // 2. Drop all collections that will be restored
  const droppedCollections = new Set();
  for (const { collection } of collections) {
    if (droppedCollections.has(collection)) continue;
    try {
      await db.dropCollection(collection);
      logger.info(`  Dropped: ${collection}`);
    } catch (err) {
      if (err.codeName === 'NamespaceNotFound') {
        logger.info(`  ${collection}: not found (skip drop)`);
      } else {
        throw err;
      }
    }
    droppedCollections.add(collection);
  }

  // 3. Stream the dump file and insert documents
  logger.info('Restoring documents...');
  const isGzipped = inputPath.endsWith('.gz');
  const fileStream = fs.createReadStream(inputPath);
  const input = isGzipped ? fileStream.pipe(createGunzip()) : fileStream;
  const rl = readline.createInterface({ input, croppingThreshold: 0 });

  let currentCollection = null;
  let currentCollectionName = null;
  let batch = [];
  let totalInserted = 0;
  let collectionInserted = 0;
  const summary = {};

  for await (const line of rl) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.warn('  Skipping malformed line');
      continue;
    }

    // Skip metadata line
    if (parsed.__meta) continue;

    // Collection boundary — flush previous batch and switch
    if (parsed.__collection) {
      // Flush remaining batch for previous collection
      if (batch.length > 0 && currentCollection) {
        await insertBatch(currentCollection, batch);
        totalInserted += batch.length;
        collectionInserted += batch.length;
        batch = [];
      }

      if (currentCollectionName) {
        summary[currentCollectionName] = collectionInserted;
        logger.info(`  ${currentCollectionName}: ${collectionInserted} docs inserted`);
      }

      currentCollectionName = parsed.collection;
      currentCollection = db.collection(parsed.collection);
      collectionInserted = 0;
      continue;
    }

    // Regular document line
    batch.push(line);
    if (batch.length >= BATCH_SIZE) {
      await insertBatch(currentCollection, batch);
      totalInserted += batch.length;
      collectionInserted += batch.length;
      batch = [];
    }
  }

  // Flush final batch
  if (batch.length > 0 && currentCollection) {
    await insertBatch(currentCollection, batch);
    totalInserted += batch.length;
    collectionInserted += batch.length;
  }
  if (currentCollectionName) {
    summary[currentCollectionName] = collectionInserted;
    logger.info(`  ${currentCollectionName}: ${collectionInserted} docs inserted`);
  }

  // 4. Rebuild indexes for all mongoose models
  logger.info('Rebuilding indexes...');
  const modelNames = mongoose.modelNames();
  for (const modelName of modelNames) {
    try {
      await mongoose.model(modelName).syncIndexes();
      logger.info(`  ${modelName}: indexes synced`);
    } catch (err) {
      // Discriminator models may fail if base model already synced — that's fine
      logger.warn(`  ${modelName}: ${err.message}`);
    }
  }

  // 5. Seed the keyv block cache so the retriever resumes from the right block.
  //    Without this, getLastL1CachedBlock() falls back to Starknet.originBlock,
  //    causing a full re-sync from the beginning.
  logger.info('Seeding block cache...');
  const latestL1Event = await mongoose.model('Starknet')
    .findOne({ status: 'ACCEPTED_ON_L1', removed: { $ne: true } })
    .sort({ blockNumber: -1 })
    .lean();

  if (latestL1Event) {
    await StarknetBlockCache.setl1AcceptedBlock(latestL1Event.blockNumber);
    logger.info(`  Set ACCEPTED_L1_BLOCK to ${latestL1Event.blockNumber}`);
  } else {
    logger.warn('  No ACCEPTED_ON_L1 events found — retriever will sync from origin block');
  }

  // Summary
  logger.info('--- Restore Summary ---');
  Object.entries(summary).forEach(([name, count]) => {
    logger.info(`  ${name}: ${count}`);
  });
  logger.info(`Total documents: ${totalInserted}`);
  logger.info(`Starknet block at dump: ${meta.starknetBlock}`);
  logger.info('The server should now resume syncing from the latest ACCEPTED_ON_L1 event.');
};

main()
  .then(() => { logger.info('Restore complete.'); process.exit(0); })
  .catch((err) => { logger.error(err); process.exit(1); });
