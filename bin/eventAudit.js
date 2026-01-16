require('dotenv').config({ silent: true });
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { map } = require('lodash');
const { EthereumRetriever } = require('../lib/events/retrievers/ethereum/retriever');
const EventModel = require('../models/Event/Ethereum');

mongoose.connect(process.env.MONGO_URL);

const log = console;

const EVENT_SOURCES = {
  ethereum: EthereumRetriever
};

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const args = yargs(hideBin(process.argv))
  .option('eventSource', {
    type: 'string',
    choices: Object.keys(EVENT_SOURCES),
    default: 'ethereum'
  })
  .option('fromBlock', {
    type: 'integer',
    demand: true
  })
  .option('toBlock', {
    type: 'integer',
    demand: false
  })
  .option('showEvents', {
    type: 'boolean',
    demand: false
  })
  .options('showMissing', {
    type: 'boolean',
    demand: false
  })
  .options('showDups', {
    type: 'boolean',
    demand: false
  })
  .help()
  .parse();

const main = async function ({ eventSource, fromBlock, toBlock, showDups, showEvents, showMissing }) {
  // instatiate retrievers(s)
  const retriever = new EVENT_SOURCES[eventSource]();

  const events = await retriever.pullEvents({ fromBlock, toBlock });
  log.info(`onChain event count: [${events.length}]`);
  if (showEvents) log.info('onChain Events: ', events);

  if (events.length === 0) throw new Error(`No events found since: ${fromBlock}`);

  // get maching local event count
  // const query = { $or: [] };
  // query.$or = events.map((event) => (
  //   {
  //     blockHash: event.blockHash,
  //     transactionHash: event.transactionHash,
  //     logIndex: event.logIndex,
  //     event: event.event
  //   }
  // ));
  const query = { $and: [{ blockNumber: { $gte: fromBlock } }] };
  if (toBlock) query.$and.push({ blockNumber: { $lte: toBlock } });

  const localEventCount = await EventModel.countDocuments(query);
  log.info(`local event count: [${localEventCount}]`);

  const eventCountDiff = events.length - localEventCount;

  log.info(`difference of onChan vs local: ${eventCountDiff}`);

  if (eventCountDiff === 0) return;
  if (!showDups && !showMissing) return;
  for await (const event of events) { // eslint-disable-line
    log.info(`searching for event: ${event.blockNumber}`);
    const matches = await EventModel.find(
      {
        blockHash: event.blockHash,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        event: event.event
      }
    );
    if (matches.length > 1 && showDups) log.info('dup events: ', map(matches, '_id'));

    if (matches.length === 0 && showMissing) log.info('missing event for: ', event);
  }
};

main(args)
  .then(done)
  .catch(done);
