const ProcessTypeHandler = require('./events/handlers/starknet/Dispatcher/components/ProcessType');
const StarknetEventService = require('../services/Event/Starknet');

// Discover only definition blocks, then reuse normal retrieval to retain canonical event indices.
const backfillMissionProcessTypes = async ({ rpc, retriever, address, fromBlock, toBlock }) => {
  const blocks = new Set();
  let continuationToken;
  do {
    const page = await rpc.getEvents({
      address,
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      keys: ProcessTypeHandler.eventConfig.keys.map((key) => [key]),
      chunk_size: 100,
      ...(continuationToken ? { continuation_token: continuationToken } : {})
    });
    page.events.forEach((event) => blocks.add(event.block_number));
    continuationToken = page.continuation_token;
  } while (continuationToken);

  let count = 0;
  for (const blockNumber of [...blocks].sort((a, b) => a - b)) {
    const events = (await retriever.pullAndFormatEvents({ blockNumber }))
      .filter((event) => event.event === ProcessTypeHandler.eventName);
    if (events.length) await StarknetEventService.updateOrCreateMany(events);
    count += events.length;
  }
  return { blocks: blocks.size, events: count };
};

module.exports = backfillMissionProcessTypes;
