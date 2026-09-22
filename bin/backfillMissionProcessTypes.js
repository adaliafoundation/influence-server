require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { createRpcProvider } = require('@common/lib/starknet/client');
const logger = require('@common/lib/logger');

const args = yargs(hideBin(process.argv))
  .option('fromBlock', { type: 'number', default: Number(appConfig.get('Starknet.originBlock')) })
  .option('toBlock', { type: 'number', demandOption: true })
  .check(({ fromBlock, toBlock }) => {
    if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock)
      || fromBlock < 0 || toBlock < fromBlock) throw new Error('Invalid block range');
    return true;
  })
  .strict()
  .parseSync();

const StarknetRetriever = require('@common/lib/events/retrievers/starknet/retriever');
const backfill = require('@common/lib/backfillMissionProcessTypes');
const { mongoose } = require('@common/storage/db');

const main = async () => {
  await mongoose.connection.asPromise();
  await mongoose.model('ProcessTypeComponent').createIndexes();
  const rpc = await createRpcProvider({
    nodeUrl: appConfig.get('EventRetriever.starknet.rpcProvider') || appConfig.get('Starknet.rpcProvider')
  });
  const result = await backfill({
    rpc,
    retriever: new StarknetRetriever(),
    address: appConfig.get('Contracts.starknet.dispatcher'),
    fromBlock: args.fromBlock,
    toBlock: args.toBlock
  });
  logger.info(`Queued ${result.events} ProcessType events from ${result.blocks} blocks for the event processor.`);
};

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
