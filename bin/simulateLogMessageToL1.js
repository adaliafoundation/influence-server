#!/usr/bin/env node
require('dotenv').config({ silent: true });
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

const cache = require('../lib/cache');
const EthereumEvent = require('../models/Event/Ethereum');
const Event = require('../models/Event');

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const argv = yargs(hideBin(process.argv))
  .option('tx', {
    type: 'string',
    demand: true
  })
  .parse();

const main = async function ({ tx }) {
  if (process.env.NODE_ENV !== 'development') return;

  const events = await Event.find({ event: 'Bridged_ToL1', transactionHash: `${tx}` }).exec() || [];
  if (events.length === 0) throw new Error('no events with that tx hash');

  const fromAddress = BigInt(events[0].address).toString();
  const toAddress = events[0].address === process.env.STARKNET_CONTRACT_ASTEROID_TOKEN_BRIDGE
    ? process.env.CONTRACT_ASTEROID_TOKEN_BRIDGE
    : process.env.CONTRACT_CREW_TOKEN_BRIDGE;

  const assetIds = events.map((e) => e.returnValues.tokenId);
  const payload = [
    assetIds.length,
    fromAddress,
    events[0].returnValues.from,
    events[0].returnValues.to,
    ...assetIds
  ].map((p) => BigInt(p).toString());

  // TODO: get current eth block
  const cachedBlockNumber = await cache.get('CURRENT_ETH_BLOCK_NUMBER');

  const eventDoc = new EthereumEvent({
    id: `log_fake_${cachedBlockNumber}`,
    address: process.env.CONTRACT_STARKNET_CORE,
    blockHash: '0x0',
    blockNumber: cachedBlockNumber,
    event: 'LogMessageToL1',
    logIndex: 0,
    removed: false,
    returnValues: {
      '0': fromAddress,
      '1': toAddress,
      '2': payload,
      fromAddress,
      toAddress,
      payload
    },
    signature: '0x0',
    timestamp: Math.ceil(Date.now() / 1e3),
    transactionHash: tx,  // this is at least unique, but still not a valid l1 tx hash
    transactionIndex: 0
  });

  await eventDoc.save();
}

main(argv)
.then(() => done())
.catch(done);

