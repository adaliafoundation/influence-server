# Current lot tenancy

Lot detail responses and newly indexed lot search documents include `UseLot`:

- `UseLot: null`: current tenancy has not been populated and is unknown.
- `UseLot: { tenant: { id, label, uuid }, ... }`: the recorded on-chain tenant.
- `UseLot: { tenant: null, ... }`: an indexed event or state read confirmed no tenant.

Live updates carry normal source-event metadata. Backfilled records instead carry `snapshot: { blockNumber, blockHash }`, representing state at the end of that block. Historical events through that block cannot overwrite the snapshot. A later live update replaces it with normal event provenance. A recorded tenant is not proof of active permission; consumers must evaluate the corresponding agreement separately.

The Unique event handler indexes only `['UseLot', lot]` paths. Changes queue the lot for search indexing and notify the lot, asteroid, and affected tenant crew rooms with `ComponentUpdated_Unique`. Consumers must handle that event to refresh their data. Historical agreements remain available in lot details; search documents retain their existing agreement retention window. `LotUse` occupancy is not indexed by this change.

## Current-state backfill from influence-stack

Deploy a server image containing the rewritten backfill **and snapshot ordering guard** before starting. Run these commands from the influence-stack checkout, with its `.env`. Include any local Compose overrides that change application connectivity or credentials. No host Node installation, copied secrets, or writable container volume is required.

### What it reads

The command builds a deduplicated candidate list from MongoDB:

- All indexed USE_LOT agreements: prepaid (including expired), contract, whitelist, and account whitelist.
- Current building locations on lots.
- Already indexed `UseLot` records.

It reads each candidate's single Unique storage word directly from the configured Dispatcher using `starknet_getStorageAt`. The key follows the contract's `components::resolve` Poseidon hashing and Cairo storage-address normalization. Zero means no tenant. RPC errors stop the job; they are never interpreted as zero.

There is **no historical event scan**. The default is one storage request at a time with a 100 ms pause after each read. Increase `--delayMs` to reduce load further. Candidate collection streams database records and stages deduplicated lots in MongoDB. Expect approximately one state RPC per candidate, plus occasional block checks and retries.

The first scan pins the latest `l1_accepted` block and saves its hash. All reads use that hash, including resumed runs. No starting block is needed. Optional `--blockNumber N` selects an explicit L1-accepted snapshot; the provider must retain state at that block. The old `--fromBlock`, `--toBlock`, and `--batchSize` flags are no longer supported.

### 1. Estimate work, then scan with the stack running

```sh
# Counts unique candidates; no per-lot RPC reads or job/component writes.
docker compose --env-file .env -f compose.yaml run --rm --no-deps \
  influence-starknet-event-retriever \
  node bin/backfill_lot_tenancy.js --phase scan --dryRun

# Reads and stages current state. No workers need to stop.
docker compose --env-file .env -f compose.yaml run --rm --no-deps \
  influence-starknet-event-retriever \
  node bin/backfill_lot_tenancy.js --phase scan --delayMs 100
```

Dry-run counts use an in-memory set of candidate lot IDs; the actual scan uses MongoDB staging. The normal scan does not change live components, event records, retrieval checkpoints, or emit websocket notifications. Each successful read is saved independently. Repeat the command after interruption to read only unfinished candidates at the original snapshot block. Candidate enumeration itself is also restartable.

Run only one backfill process at a time against a database. The default job name is `lot-tenancy-state-v2`. Historical event-backfill jobs are incompatible and rejected; do not reuse their names. Use `--job NAME` consistently for a separate current-state job.

### 2. Inspect the snapshot

```sh
docker compose --env-file .env -f compose.yaml run --rm --no-deps \
  influence-starknet-event-retriever \
  node bin/backfill_lot_tenancy.js --phase status
```

The summary includes the snapshot block, phase, candidate count (`lots`), successful reads (`read`), assigned/cleared counts, and applied/skipped-newer counts. Apply only after `phase: "ready"`. `--phase apply --dryRun` verifies the cutoff and reports this summary without changing live records.

### 3. Pause processing, apply, and restart

```sh
docker compose --env-file .env -f compose.yaml stop influence-event-processor

docker compose --env-file .env -f compose.yaml run --rm --no-deps \
  influence-starknet-event-retriever \
  node bin/backfill_lot_tenancy.js --phase apply --processorStopped

# Run after apply succeeds:
docker compose --env-file .env -f compose.yaml start influence-event-processor
```

`--processorStopped` acknowledges an operator action; it does not inspect Docker. Stop every processor writing to the same database and avoid automatic restarts/deployments during apply. Retrieval and search indexing may continue. API readiness can fail while processing is paused, so schedule apply as maintenance.

Apply records snapshot provenance without inventing source events, preserves newer live events or snapshots, and queues affected lots for search indexing. It does not change agreement history or send historical websocket notifications. The snapshot ordering guard also protects the results from older queued events after the processor resumes. Progress is saved per lot; if apply fails, keep processing paused and repeat the command. Completed jobs are a no-op.

Confirm `phase: "complete"`, check `./stack status`, and let the search index queue drain. Sample active, expired, and cleared lots against chain state and API responses. State can legitimately change after the saved snapshot.

### Coverage and storage

Candidate coverage depends on indexed agreements and building locations. A lot absent from all candidate sources stays unknown; the command does not claim complete coverage of every lot on chain. Confirmed empty candidates are populated with `tenant: null`. Existing search documents without `UseLot` remain unknown until populated/reindexed.

Checkpoints and staged state remain in `lot_tenancy_backfills` and `lot_tenancy_backfill_lots`. Do not reset or delete a job while a process is using it. No production backfill is performed merely by deploying this code.
