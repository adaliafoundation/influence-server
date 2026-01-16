require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { EthereumRetriever } = require('@common/lib/events/retrievers/ethereum/retriever');
const { StarknetRetriever } = require('@common/lib/events/retrievers/starknet/retriever');
const logger = require('@common/lib/logger');

const EVENT_SOURCES = {
  ethereum: EthereumRetriever,
  starknet: StarknetRetriever
};

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const args = yargs(hideBin(process.argv))
  .option('eventSource', {
    type: 'string',
    choices: Object.keys(EVENT_SOURCES),
    default: 'ethereum'
  })
  .option('contractAddress', {
    type: 'string',
    default: null
  })
  .option('fromBlock', {
    type: 'integer',
    demand: false
  })
  .option('toBlock', {
    type: 'integer',
    demand: false,
    default: 'latest'
  })
  .option('blocks', {
    demand: false,
    type: 'array'
  })
  .option('run-once', {
    type: 'boolean',
    default: false,
    demand: false
  })
  .option('onlyMisingBlocks', {
    description: 'Only query blocks where no events have been retrieved',
    type: 'boolean',
    default: false,
    demand: false
  })
  .help()
  .parse();

const main = async function ({ blocks, eventSource, fromBlock, toBlock, runOnce, contractAddress, onlyMisingBlocks }) {
  // instatiate retrievers(s)
  const retriever = new EVENT_SOURCES[eventSource]();

  // if runOnce, run the retriever one time and exit
  if (runOnce) {
    await retriever.runOnce({ blocks, fromBlock, toBlock, contractAddress, onlyMisingBlocks });
    return;
  }

  try {
    // initialize event listeners
    if (retriever.initListeners) await retriever.initListeners();

    // run the event retriever
    await retriever.runner();
  } catch (error) {
    logger.inspect(error, 'error');
  }
};

main(args)
  .then(done)
  .catch(done);
