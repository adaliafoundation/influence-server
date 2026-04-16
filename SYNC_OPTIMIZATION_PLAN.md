# Sync Pipeline Optimization Plan

## Context

When the server starts from a dump restore (or falls behind), it needs to catch up to the current Starknet block. The current pipeline processes blocks sequentially with significant idle time between them, making catch-up much slower than necessary.

This plan identifies bottlenecks in the retriever and processor pipeline and proposes targeted fixes.

## Current pipeline

```
Retriever (per block)                    Processor (per cycle, every 5s)
-------------------------------          --------------------------------
1. getBlock(N)          [RPC]            1. find({lastProcessed: null})   [DB]
2. sleep(1000ms)        [WAIT]           2. for each event (serial):
3. getEventsBatch(N)    [RPC batch]         a. findOrCreateOne activity   [DB x2]
4. for each tx (serial):                    b. updateOrCreateFromEvent    [DB x3]
   getTransactionReceipt [RPC]              c. set lastProcessed + save   [DB x1]
5. for each receipt (serial):               d. emitSocketEvents           [socket]
   getBlockWithTxHashes  [RPC, cached]   3. getBlockNumber               [RPC]
6. updateOrCreateMany    [DB bulkWrite]  4. sleep(remaining of 5s)
7. update caches         [DB]
```

## Bottleneck 1: Hardcoded 1-second sleep per block (HIGH impact)

**File:** `src/common/lib/events/retrievers/starknet/retriever.js:123`

```js
await new Promise((resolve) => { delay(resolve, 1000); });
```

Every block gets a 1-second sleep before processing. Catching up 1,000 blocks = ~17 minutes of pure sleeping. Most blocks have zero game events.

**Fix:** Skip the sleep when catching up (i.e., when `fromBlock` is more than a few blocks behind `toBlock`). Only throttle near the chain head to avoid hammering the RPC during steady-state.

```js
const catchUpThreshold = 5; // blocks behind head before we consider it catch-up
const isCatchingUp = (toBlock - b) > catchUpThreshold;
if (!isCatchingUp) {
  await new Promise((resolve) => { delay(resolve, 1000); });
}
```

## Bottleneck 2: Sequential block processing (HIGH impact)

**File:** `src/common/lib/events/retrievers/starknet/retriever.js:122-126`

Blocks are processed one at a time in a `for` loop. Each block needs at minimum 2 RPC round-trips (~200-400ms of network latency), purely sequential.

**Fix:** During catch-up, process blocks in parallel batches. Fetch N blocks concurrently, then save events in order.

```js
const PARALLEL_BLOCKS = 5;

for (let b = Number(fromBlock); b <= Number(toBlock); b += PARALLEL_BLOCKS) {
  const batch = [];
  for (let i = 0; i < PARALLEL_BLOCKS && (b + i) <= toBlock; i++) {
    batch.push(this.retrieveAndProcessBlock(b + i));
  }
  await Promise.all(batch);
}
```

**Consideration:** `updateOrCreateMany` uses upsert with unique constraints, so parallel writes for different blocks are safe. The `processBlock` cache interactions need care — the L2 cache reads/writes could race. Safest approach: separate the "fetch" step (RPC calls, pure read) from the "persist" step (DB writes, cache updates), parallelize only the fetch.

## Bottleneck 3: Sequential event processing (MEDIUM impact)

**File:** `src/common/lib/events/processor/EventProcessor.js:31`

```js
return eachSeries(events, async (event) => { ... });
```

Events are processed strictly one at a time. Each handler does 2-5 DB operations.

**Fix:** Group events by transaction hash. Events within a transaction stay serial (ordering matters). Different transactions can be processed in parallel.

```js
const grouped = groupBy(events, 'transactionHash');
const txGroups = Object.values(grouped);

// Process up to N transaction groups in parallel
const PARALLEL_TXS = 3;
for (let i = 0; i < txGroups.length; i += PARALLEL_TXS) {
  const batch = txGroups.slice(i, i + PARALLEL_TXS);
  await Promise.all(batch.map((txEvents) => eachSeries(txEvents, processOne)));
}
```

**Consideration:** Some handlers query/update the same component across transactions (e.g., two transactions updating the same crew's location). The `updateOrCreateFromEvent` method already handles this with timestamp-based conflict resolution, so concurrent updates should be safe — the newer event wins regardless of write order.

## Bottleneck 4: Sequential transaction receipt fetching (MEDIUM impact)

**File:** `src/common/lib/starknet/providers/rpc.js:214`

```js
for (const transactionHash of txHashes) {
  receipts.push(await this._getTransactionReceipt({ transactionHash }));
}
```

When a block has multiple transactions with game events, each receipt is fetched one at a time.

**Fix:** Fetch receipts in parallel (with a concurrency limit to avoid RPC rate limits).

```js
const RECEIPT_CONCURRENCY = 5;
for (let i = 0; i < txHashes.length; i += RECEIPT_CONCURRENCY) {
  const batch = txHashes.slice(i, i + RECEIPT_CONCURRENCY);
  const results = await Promise.all(
    batch.map((txHash) => this._getTransactionReceipt({ transactionHash: txHash }))
  );
  receipts.push(...results);
}
```

## Bottleneck 5: Individual `finalizeEvent` saves (LOW impact)

**File:** `src/common/lib/events/handlers/BaseHandler.js:55-58`

Each processed event gets its own `event.save()` to stamp `lastProcessed`. Processing 1,000 events = 1,000 individual MongoDB updates.

**Fix:** Batch the `lastProcessed` update. After processing a group of events, do a single `updateMany`:

```js
const processedIds = [];
for (const event of events) {
  // ... process event ...
  processedIds.push(event._id);
}
await Event.updateMany(
  { _id: { $in: processedIds } },
  { lastProcessed: new Date() }
);
```

**Consideration:** This changes the failure semantics. Currently, if event N fails, events 1..N-1 are already finalized. With batching, a failure loses the progress marker for the whole batch. Mitigation: keep batches small (e.g., per-transaction groups) so re-processing on failure is bounded.

## Not worth changing

- **Dropping old resolved events:** The `getNonProcessed` query uses an index on `{lastProcessed: 1, timestamp: -1}`. Resolved events don't participate in any hot path. Removing them saves disk but doesn't affect sync speed.
- **`updateOrCreateFromEvent` doing 3 DB ops:** The find + populate + save pattern is needed for correct event ordering. Optimizing it would require a fundamentally different approach (e.g., in-memory state) with high risk.
- **EventProcessor's `processStarknetBlockNumber` RPC call:** One call per 5-second cycle is negligible.

## Implementation order

| Priority | Bottleneck | Estimated impact | Risk |
|----------|-----------|-----------------|------|
| 1 | Remove catch-up sleep | Very high — eliminates ~1s per block | Very low |
| 2 | Parallel block fetching | High — reduces RPC latency wall | Low-medium (cache interactions) |
| 3 | Parallel event processing | Medium — reduces DB latency wall | Medium (concurrent writes) |
| 4 | Parallel receipt fetching | Medium — helps blocks with many txs | Low |
| 5 | Batch finalizeEvent | Low — saves DB round-trips | Low-medium (failure semantics) |
