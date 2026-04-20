require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const logger = require('@common/lib/logger');
const StarknetProvider = require('@common/lib/starknet/provider');
const { StarknetRetriever } = require('@common/lib/events/retrievers/starknet/retriever');
const EventProcessor = require('@common/lib/events/processor/EventProcessor');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const args = yargs(hideBin(process.argv))
  .option('block', {
    type: 'number',
    description: 'Starknet block number to fork from (default: latest)',
    demand: false
  })
  .option('label', {
    type: 'string',
    description: 'Human-readable label for this universe',
    default: null
  })
  .option('empty', {
    type: 'boolean',
    description: 'Create an empty world fork without syncing chain state (for local hybrid dev)',
    default: false
  })
  .help()
  .parse();

const main = async function ({ block, label, empty }) {
  const WorldFork = mongoose.model('WorldFork');

  // Check if already forked
  const existing = await WorldFork.findOne({});
  if (existing) {
    logger.error(
      `World already forked at block ${existing.blockNumber} (${existing.forkedAt.toISOString()}).`
      + ' Drop the database to re-fork.'
    );
    return;
  }

  if (empty) {
    // Create an empty world fork for local hybrid development
    const forkBlock = block || 0;
    const forkLabel = label || `empty-fork-${forkBlock}`;
    await WorldFork.create({
      blockNumber: forkBlock,
      blockHash: '0x0',
      blockTimestamp: new Date(),
      forkedAt: new Date(),
      label: forkLabel
    });
    logger.info(`Empty world fork created (block: ${forkBlock}, label: ${forkLabel})`);
    return;
  }

  // 1. Resolve target block
  const provider = new StarknetProvider();
  const targetBlockNumber = block || await provider.getBlockNumber();
  const targetBlock = await provider.getBlock(targetBlockNumber);

  logger.info(`Forking world from Starknet block ${targetBlockNumber} (hash: ${targetBlock.blockHash})`);

  // 2. Retrieve all events from genesis to target block
  const retriever = new StarknetRetriever();
  await retriever.runOnce({ fromBlock: 0, toBlock: targetBlockNumber });

  // 3. Process all retrieved events (runDelay must be > 0 for constructor)
  const processor = new EventProcessor({ runDelay: 1 });
  await processor.main({ timeStamp: 0 });

  // 4. Record the fork point
  await WorldFork.create({
    blockNumber: targetBlockNumber,
    blockHash: targetBlock.blockHash,
    blockTimestamp: new Date(targetBlock.timestamp * 1000),
    forkedAt: new Date(),
    label: label || `fork-${targetBlockNumber}`
  });

  // 5. Summary
  const NftComponent = mongoose.model('NftComponent');
  const asteroidCount = await NftComponent.countDocuments({ 'entity.label': 3 });
  const crewmateCount = await NftComponent.countDocuments({ 'entity.label': 2 });

  logger.info([
    'World fork complete:',
    `  Block:      ${targetBlockNumber}`,
    `  Hash:       ${targetBlock.blockHash}`,
    `  Timestamp:  ${new Date(targetBlock.timestamp * 1000).toISOString()}`,
    `  Label:      ${label || `fork-${targetBlockNumber}`}`,
    `  Asteroids:  ${asteroidCount}`,
    `  Crewmates:  ${crewmateCount}`
  ].join('\n'));
};

main(args)
  .then(done)
  .catch(done);
