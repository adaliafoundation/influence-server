#!/usr/bin/env node

/**
 * Dumps the current database state to a gzipped NDJSON file.
 *
 * Includes:
 *   - Full game state (entities, constants, all components, etc.)
 *   - All unresolved events (lastProcessed === null)
 *   - Resolved events from the last --days days
 *   - User/social data (users, activities, event annotations, notifications, DMs)
 *   - Metadata: generation timestamp and current Starknet block number
 *
 * Usage:
 *   node bin/dump.js [options]
 *
 * Options:
 *   --output, -o    Output file path (default: ./dump-{timestamp}.ndjson.gz)
 *   --days, -d      Days of resolved events to include (default: 30)
 *   --no-compress   Output plain NDJSON instead of gzipped
 */
require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');

const fs = require('fs');
const path = require('path');
const { createGzip } = require('zlib');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { StarknetBlockCache } = require('@common/lib/cache');
const { StarknetEventService } = require('@common/services');
const logger = require('@common/lib/logger');

const args = yargs(hideBin(process.argv))
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Output file path'
  })
  .option('days', {
    alias: 'd',
    type: 'number',
    description: 'Days of resolved events to include',
    default: 30
  })
  .option('compress', {
    type: 'boolean',
    description: 'Gzip the output (use --no-compress to disable)',
    default: true
  })
  .help()
  .parse();

// Collections to dump, in order. Each entry is either:
//   - a model name string (dump all docs)
//   - { model, query } for custom filtering
// Discriminator models (Starknet, Ethereum, Notification subtypes) share a base
// collection; we dump via the base model to get all docs in one pass.
const GAME_STATE_MODELS = [
  'Entity',
  'Constant',
  'Entropy',
  'WorldFork'
];

// All component models from Components/index.js
const COMPONENT_MODELS = [
  'AsteroidProofComponent',
  'AsteroidRewardComponent',
  'BuildingComponent',
  'CelestialComponent',
  'ContractAgreementComponent',
  'ContractPolicyComponent',
  'ControlComponent',
  'CrewComponent',
  'CrewmateComponent',
  'CrewmateRewardComponent',
  'DeliveryComponent',
  'DepositComponent',
  'DockComponent',
  'DryDockComponent',
  'ExchangeComponent',
  'ExtractorComponent',
  'InternalSaleComponent',
  'InventoryComponent',
  'LocationComponent',
  'NameComponent',
  'NftComponent',
  'OrderComponent',
  'OrbitComponent',
  'PrepaidAgreementComponent',
  'PrepaidMerklePolicyComponent',
  'PrepaidPolicyComponent',
  'PrivateSaleComponent',
  'ProcessorComponent',
  'PublicPolicyComponent',
  'ShipComponent',
  'StationComponent',
  'WhitelistAgreementComponent',
  'WhitelistAccountAgreementComponent'
];

const SOCIAL_MODELS = [
  'User',
  'Activity',
  'EventAnnotation',
  'DirectMessage'
];

/**
 * Write a single line to the output stream. Returns a promise that resolves
 * when the write buffer is flushed (backpressure-aware).
 */
function writeLine(stream, obj) {
  const line = EJSON.stringify(obj, { relaxed: false }) + '\n';
  if (!stream.write(line)) {
    return new Promise((resolve) => stream.once('drain', resolve));
  }
  return Promise.resolve();
}

/**
 * Dump all documents from a mongoose model (via cursor) to the output stream.
 * Returns the number of documents written.
 */
async function dumpCollection(stream, modelName, query = {}) {
  const Model = mongoose.model(modelName);
  const count = await Model.countDocuments(query);
  const collectionLabel = Model.collection.collectionName;

  await writeLine(stream, { __collection: collectionLabel, modelName, count });
  logger.info(`  ${modelName} (${collectionLabel}): ${count} docs`);

  let written = 0;
  const cursor = Model.find(query).lean().cursor();
  for await (const doc of cursor) {
    await writeLine(stream, doc);
    written++;
    if (written % 10000 === 0) {
      logger.info(`    ...${written}/${count}`);
    }
  }

  return written;
}

const main = async () => {
  // Wait for DB connection
  await new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
    return undefined;
  });

  // Determine current Starknet block
  let starknetBlock = await StarknetBlockCache.getCurrentBlockNumber();
  if (!starknetBlock) {
    const latestEvent = await StarknetEventService.getLatestEventByBlock();
    starknetBlock = latestEvent?.blockNumber || null;
  }
  logger.info(`Current Starknet block: ${starknetBlock}`);

  // Determine output path
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = args.compress ? '.ndjson.gz' : '.ndjson';
  const outputPath = args.output || path.join(process.cwd(), `dump-${timestamp}${ext}`);

  // Set up output stream
  const fileStream = fs.createWriteStream(outputPath);
  let output;
  if (args.compress) {
    const gzip = createGzip();
    gzip.pipe(fileStream);
    output = gzip;
  } else {
    output = fileStream;
  }

  const generatedAt = new Date().toISOString();
  logger.info(`Dumping to: ${outputPath}`);
  logger.info(`Including resolved events from last ${args.days} day(s)`);

  // Write metadata
  await writeLine(output, {
    __meta: {
      version: 1,
      generatedAt,
      starknetBlock,
      eventDays: args.days
    }
  });

  const summary = {};

  // 1. Game state collections
  logger.info('Dumping game state...');
  for (const modelName of GAME_STATE_MODELS) {
    summary[modelName] = await dumpCollection(output, modelName);
  }

  // 2. Component collections
  logger.info('Dumping components...');
  for (const modelName of COMPONENT_MODELS) {
    summary[modelName] = await dumpCollection(output, modelName);
  }

  // 3. Social/user collections
  logger.info('Dumping user/social data...');
  for (const modelName of SOCIAL_MODELS) {
    summary[modelName] = await dumpCollection(output, modelName);
  }

  // 4. Notifications (all discriminators stored in one collection — dump via base model)
  logger.info('Dumping notifications...');
  summary.Notification = await dumpCollection(output, 'Notification');

  // 5. Events — unresolved + resolved from last X days
  // Events use discriminators (Starknet, Ethereum) but all live in the `events` collection.
  // We dump via the base Event model to get all discriminator docs in one pass.
  logger.info('Dumping events...');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - args.days);
  const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);

  const eventQuery = {
    removed: { $ne: true },
    $or: [
      { lastProcessed: null },
      { lastProcessed: { $ne: null }, timestamp: { $gte: cutoffTimestamp } }
    ]
  };
  summary.Event = await dumpCollection(output, 'Event', eventQuery);

  // Close the stream
  await new Promise((resolve, reject) => {
    output.on('finish', resolve);
    output.on('error', reject);
    output.end();
  });

  // Summary
  const totalDocs = Object.values(summary).reduce((a, b) => a + b, 0);
  const fileSize = fs.statSync(outputPath).size;
  const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

  logger.info('--- Dump Summary ---');
  Object.entries(summary).forEach(([name, count]) => {
    logger.info(`  ${name}: ${count}`);
  });
  logger.info(`Total documents: ${totalDocs}`);
  logger.info(`File: ${outputPath} (${fileSizeMB} MB)`);
  logger.info(`Starknet block: ${starknetBlock}`);
  logger.info(`Generated at: ${generatedAt}`);
};

main()
  .then(() => { logger.info('Dump complete.'); process.exit(0); })
  .catch((err) => { logger.error(err); process.exit(1); });
