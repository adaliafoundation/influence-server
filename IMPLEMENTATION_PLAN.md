# Implementation Plan: Hybrid Local Game Mode

## Goal

Add a `GAME_MODE=hybrid` option to the influence-server that:

1. **Keeps on-chain:** Starknet wallet authentication + Asteroid and Crewmate NFT ownership tracking
2. **Moves off-chain:** All game actions (construction, mining, processing, trading, transit, etc.) — validated and executed locally, stored in MongoDB
3. **No forking:** Same codebase, behavior controlled by environment variables

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start: Running a Hybrid Server](#quick-start-running-a-hybrid-server)
1. [Architecture Overview](#1-architecture-overview)
2. [Existing Simulation System (Client)](#2-existing-simulation-system-client)
3. [Phase 1: Configuration & Mode Switching](#3-phase-1-configuration--mode-switching)
4. [Phase 2: Selective Event Pipeline](#4-phase-2-selective-event-pipeline)
5. [Phase 3: Game Action API Endpoints](#5-phase-3-game-action-api-endpoints)
6. [Phase 4: Game Logic Engine](#6-phase-4-game-logic-engine)
7. [Phase 5: Client Integration](#7-phase-5-client-integration)
8. [Phase 6: Login & Ownership Sync](#8-phase-6-login--ownership-sync)
9. [Phase 7: Time & Tick System](#9-phase-7-time--tick-system)
10. [Phase 8: Testing & Verification](#10-phase-8-testing--verification)
11. [File Change Map](#11-file-change-map)
12. [Implementation Order & Dependencies](#12-implementation-order--dependencies)
13. [Risks & Open Questions](#13-risks--open-questions)

---

## 1. Architecture Overview

### Current Flow (chain mode)
```
Player → Starknet Contract → emits Event → EventRetriever → MongoDB → EventProcessor
  → updates Entities/Components → IndexItem → ElasticSearch Indexer
  → Socket.IO broadcast to clients
```

### Hybrid Flow
```
ON-CHAIN (kept):
  Wallet auth → JWT (unchanged)
  Asteroid NFT Transfer events → EventRetriever → MongoDB (ownership only)
  Crewmate NFT Transfer events → EventRetriever → MongoDB (ownership only)

LOCAL (new):
  Player → POST /v2/actions/:action → GameLogicEngine
    → validates (permissions, resources, state machines)
    → writes Entities/Components to MongoDB
    → creates IndexItem for ElasticSearch
    → emits Socket.IO events
    → returns result to client
```

### What stays untouched
- All read-path API controllers (entities, search, metadata, images, lots, activity, users)
- MongoDB models and ECS data structures
- Elasticsearch indexing worker + formatters
- NFT card builder worker
- Socket.IO infrastructure
- JWT authentication (wallet-based)
- Redis caching layer
- CDN/image generation

---

## 2. Existing Simulation System (Client)

The client already has a tutorial/simulation system in `influence-client/src/simulation/` that is directly relevant. It provides a working reference for how game actions can be handled locally:

### Key Files
| File | Purpose |
|------|---------|
| `simulationConfig.js` | Defines mock entity IDs, starting resources, account address |
| `MockTransactionManager.js` | Intercepts `executeSystem()` calls, applies state changes locally instead of submitting to Starknet, emits mock events |
| `MockDataManager.js` | Overrides React Query cache with simulated entity data (buildings, inventories, ships, deposits, agreements, lots) |
| `useSimulationSteps.js` | Orchestrates the tutorial step sequence |
| `useSimulationEnabled.js` | Returns `true` when no wallet connected AND simulation mode is on |
| `useSimulationState.js` | Returns simulation state from Zustand store (or null if not in simulation) |

### How Simulation Mode Activates
In `influence-client/src/hooks/useSimulationEnabled.js`:
```js
const useSimulationEnabled = () => {
  const { accountAddress } = useSession(false);
  const simulationEnabled = useStore(s => s.simulationEnabled);
  return !accountAddress && simulationEnabled;  // only when NOT logged in
};
```

### How Transactions Are Intercepted
In `influence-client/src/contexts/ChainTransactionContext.js` (line ~1167):
```js
const executeSystem = useCallback(async (key, vars, meta = {}) => {
  if (simulationEnabled) {
    // Creates a fake tx hash and dispatches to MockTransactionManager
    const uuid = `0x${String(performance.now()).replace('.', '')}`;
    dispatchPendingTransaction({ key, vars, meta, txHash: uuid });
    return;  // NEVER reaches Starknet
  }
  // ... normal Starknet transaction flow
});
```

### Game Actions Handled by MockTransactionManager
- `AcceptPrepaidAgreement` — leasing lots
- `ConstructionPlan` — planning a building on a lot
- `ConstructionStart` — beginning construction
- `FillSellOrder` / `BulkFillSellOrder` — buying from marketplace
- `CreateSellOrder` — listing items for sale
- `SampleDepositStart` / `SampleDepositFinish` — sampling ore deposits
- `ExtractResourceStart` / `FlexibleExtractResourceStart` — mining
- `ProcessProductsStart` — refining/manufacturing
- `AssembleShipStart` — building ships
- `StationCrew` — assigning crew to buildings
- `UndockShip` — launching ships
- `TransitBetweenStart` / `InitializeAndStartTransit` — interplanetary travel
- `ChangeName` — renaming entities

### Key Insight
The client simulation **only keeps state in the Zustand store** (browser memory) and overwrites React Query cache entries. It never persists to MongoDB. Our hybrid server mode does the same kind of work but persists to MongoDB and is authoritative for all connected clients.

### What We Can Reuse
- The `MockTransactionManager` logic maps each action to its state changes — this is a direct blueprint for the server-side game logic engine
- The mock event format shows exactly what fields the client expects in activity/event payloads
- The `MockDataManager` component structure shows which entity queries need to return updated data

---

## Prerequisites

> **MongoDB must run as a replica set** — even a single-node replica set.
> Without this, `mongoose.startSession()` / `session.startTransaction()` will
> fail with: `"Transaction numbers are only allowed on a replica set member"`.
> This applies to **all environments** — local dev, CI, staging, and production.
>
> To convert a standalone local `mongod` to a single-node replica set:
> ```bash
> # 1. Start mongod with --replSet
> mongod --replSet rs0
>
> # 2. Initiate the replica set (once)
> mongosh --eval "rs.initiate()"
> ```
>
> Or in `docker-compose.yml`:
> ```yaml
> mongo:
>   command: ["--replSet", "rs0"]
> ```
>
> The GameEngine's two-phase commit (Section 6.5) depends on transactions for
> TOCTOU protection. Without a replica set, **no hybrid-mode actions will execute**.

---

## Quick Start: Running a Hybrid Server

### 1. Infrastructure

The server needs MongoDB (replica set), and optionally Redis and Elasticsearch.
The simplest local setup uses Docker Compose:

**`docker-compose.yml`**

```yaml
version: "3.8"
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

  # One-time replica set init — run after mongo is up:
  #   docker exec -it <mongo-container> mongosh --eval "rs.initiate()"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.9.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data

volumes:
  mongo-data:
  es-data:
```

```bash
docker compose up -d
# Wait a few seconds for mongo to start, then init the replica set:
docker exec -it $(docker compose ps -q mongo) mongosh --eval "rs.initiate()"
```

If you prefer a local `mongod` without Docker, see the Prerequisites section above.

### 2. Environment

```bash
cp .env.example .env   # or create from scratch
```

**Minimal `.env` for hybrid mode:**

```bash
# ── Mode ──────────────────────────────────────────────
GAME_MODE=hybrid

# ── Server ────────────────────────────────────────────
API_SERVER=1
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:3000
JWT_SECRET=any-random-string-here

# ── MongoDB (replica set required) ────────────────────
MONGO_URL=mongodb://localhost:27017/influence

# ── Starknet RPC (needed for world fork + ownership tracking) ──
# Public endpoints work but may be rate-limited.
# For reliable forking, use an Alchemy/Infura/Blast Starknet RPC key.
STARKNET_RPC_PROVIDER=https://starknet-mainnet.public.blastapi.io
STARKNET_PROVIDER=https://alpha-mainnet.starknet.io

# ── Optional ──────────────────────────────────────────
# REDIS_URL=redis://localhost:6379
# ELASTICSEARCH_URL=http://localhost:9200
# IMAGES_SERVER=1
# IMAGES_SERVER_URL=http://localhost:3001
```

**What you can skip:**
- `ETHEREUM_PROVIDER` — not needed (Ethereum retriever is disabled in hybrid mode)
- `CONTRACT_*` — the Ethereum-era contract addresses are unused
- `AWS_*`, `SENDGRID_*`, `STRIPE_*`, `ARGENT_*` — external service integrations, not required for local play
- `CLOUDINARY_URL` — only needed if image generation is enabled

### 3. Install & Build

```bash
# Requires Node 18.15.0 (see package.json engines)
nvm use 18.15.0   # or however you manage Node versions
npm install
```

### 4. Fork the World

This snapshots the current on-chain game state into your local MongoDB.
It runs the event retriever + processor for all historical blocks, so it
takes a while on first run (minutes to hours depending on RPC speed).

```bash
# Fork from the current chain head
node src/workers/forkWorld.js

# Or fork from a specific block
node src/workers/forkWorld.js --block 850000 --label "my-local-universe"
```

When complete you'll see a summary:
```
World fork complete:
  Block:      850000
  Hash:       0x1a2b3c...
  Timestamp:  2025-01-15T12:00:00.000Z
  Label:      my-local-universe
  Asteroids:  12345
  Crewmates:  6789
```

### 5. Start the Server

**Option A — all-in-one with pm2** (starts API + all workers):

```bash
npm run pm2-watch
```

**Option B — individual processes** (more control):

```bash
# Terminal 1: API server
npm run watch

# Terminal 2: Starknet event retriever (tracks NFT ownership changes)
npm run starknetEventRetriever

# Terminal 3: Event processor
npm run eventProcessor

# Terminal 4: Elasticsearch indexer (optional — only if ES is running)
npm run elasticIndexer
```

**Workers you do NOT need in hybrid mode** (they exit automatically):
- `ethereumEventRetriever` — disabled, exits on startup
- `starknetEventAuditor` — disabled, exits on startup

### 6. Verify

```bash
# Check the API is running
curl http://localhost:3001/v2/world
# → { "forkBlock": 850000, "forkBlockHash": "0x...", "label": "my-local-universe", ... }

# Check entities exist (asteroids should be populated from the fork)
curl http://localhost:3001/v2/entities?label=1&limit=5
```

### 7. Connect the Client

In the influence-client repo, configure it to point at your local server
with hybrid mode enabled (see Section 7 — Client Integration for details):

```bash
# In influence-client/.env or appConfig
REACT_APP_API_URL=http://localhost:3001
REACT_APP_GAME_MODE=hybrid
```

### Docker: One-Command Deployment

For the simplest possible setup, the entire stack (server + workers + MongoDB +
Redis + Elasticsearch) can run with a single `docker compose up`.

**New file: `Dockerfile`**

```dockerfile
FROM node:18.15.0-slim

WORKDIR /app

# Install pm2 globally for process management
RUN npm install -g pm2

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application code
COPY . .

# The API server port
EXPOSE 3001

# Entrypoint handles: wait for mongo, init replica set, fork if needed, start pm2
ENTRYPOINT ["./docker-entrypoint.sh"]
```

**New file: `docker-entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -e

# ── Wait for MongoDB to be reachable ──────────────────
echo "Waiting for MongoDB at ${MONGO_URL:-mongodb://mongo:27017/influence}..."
until node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:27017/influence')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done
echo "MongoDB is up."

# ── Init replica set if needed (for the bundled mongo container) ──
if [ "${MONGO_INIT_REPLICA:-0}" = "1" ]; then
  echo "Initializing MongoDB replica set..."
  mongosh "${MONGO_URL:-mongodb://mongo:27017/influence}" --eval "
    try { rs.status() }
    catch(e) { rs.initiate() }
  " 2>/dev/null || true
  sleep 3
fi

# ── Fork world if not already forked ──────────────────
echo "Checking for existing world fork..."
FORK_EXISTS=$(node -e "
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  require('@common/storage/db');
  const mongoose = require('mongoose');
  setTimeout(async () => {
    try {
      const count = await mongoose.connection.db.collection('worldforks').countDocuments();
      console.log(count > 0 ? 'yes' : 'no');
    } catch(e) { console.log('no'); }
    process.exit(0);
  }, 2000);
" 2>/dev/null)

if [ "$FORK_EXISTS" = "yes" ]; then
  echo "World already forked — skipping."
else
  echo "No world fork found. Forking from chain..."
  FORK_ARGS=""
  [ -n "$FORK_BLOCK" ] && FORK_ARGS="$FORK_ARGS --block $FORK_BLOCK"
  [ -n "$FORK_LABEL" ] && FORK_ARGS="$FORK_ARGS --label $FORK_LABEL"
  node src/workers/forkWorld.js $FORK_ARGS
  echo "World fork complete."
fi

# ── Start all processes via pm2 ───────────────────────
echo "Starting influence-server (API + workers)..."
exec pm2-runtime ecosystem.config.js
```

**New file: `docker-compose.yml`** (replaces the infrastructure-only version)

```yaml
version: "3.8"

services:
  # ── Influence Server (API + all workers) ────────────
  influence-server:
    build: .
    ports:
      - "3001:3001"
    environment:
      - GAME_MODE=hybrid
      - API_SERVER=1
      - PORT=3001
      - NODE_ENV=development
      - CLIENT_URL=http://localhost:3000
      - JWT_SECRET=change-me-in-production
      - MONGO_URL=mongodb://mongo:27017/influence?replicaSet=rs0
      - MONGO_INIT_REPLICA=1
      - REDIS_URL=redis://redis:6379
      - ELASTICSEARCH_URL=http://elasticsearch:9200
      - STARKNET_RPC_PROVIDER=${STARKNET_RPC_PROVIDER:-https://starknet-mainnet.public.blastapi.io}
      - STARKNET_PROVIDER=${STARKNET_PROVIDER:-https://alpha-mainnet.starknet.io}
      # Optional: fork from a specific block instead of chain head
      # - FORK_BLOCK=850000
      # - FORK_LABEL=my-local-universe
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_started
      elasticsearch:
        condition: service_started

  # ── MongoDB (replica set) ───────────────────────────
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: mongosh --eval "db.runCommand('ping').ok" --quiet
      interval: 5s
      timeout: 5s
      retries: 10

  # ── Redis ───────────────────────────────────────────
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  # ── Elasticsearch ───────────────────────────────────
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.9.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data

volumes:
  mongo-data:
  es-data:
```

**Usage:**

```bash
# Start everything (first run will fork the world — takes a while)
docker compose up -d

# Watch the fork progress
docker compose logs -f influence-server

# Subsequent starts skip the fork — server is up in seconds
docker compose up -d

# Fork from a specific block
FORK_BLOCK=850000 docker compose up -d

# Use a dedicated Starknet RPC for faster forking
STARKNET_RPC_PROVIDER=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY docker compose up -d

# Tear down (preserves data in Docker volumes)
docker compose down

# Full reset (wipes world state — will re-fork on next start)
docker compose down -v
```

**What happens on `docker compose up`:**
1. MongoDB, Redis, Elasticsearch start in parallel
2. Server container waits for MongoDB health check
3. Entrypoint initializes the replica set (idempotent — skips if already done)
4. Checks for an existing `WorldFork` document — if none, runs `forkWorld.js`
5. Starts pm2 with all processes (API + starknet retriever + event processor + elastic indexer)
6. Ethereum retriever and auditor self-exit (hybrid mode)
7. Server is ready at `http://localhost:3001`

### Cloud Deployment Notes

- **MongoDB Atlas**: Use an M10+ cluster (replica set by default). Set `MONGO_INIT_REPLICA=0` — Atlas manages its own replica set. Transaction support is included.
- **Starknet RPC**: Use a dedicated endpoint (Alchemy, Infura, Blast) with an API key — public endpoints will likely rate-limit during the initial fork.
- **The fork step is one-time**: Once `forkWorld.js` has run, the MongoDB contains the full world state. Subsequent container restarts skip directly to pm2 startup.
- **Scaling**: The `influence-server` container can be split into separate API and worker containers sharing the same `MONGO_URL` for production deployments.

---

## 3. Phase 1: Configuration & Mode Switching

### 3.1 New Environment Variables

Add to `.env`:
```
GAME_MODE=hybrid                    # "chain" (default, current behavior) or "hybrid"
CHAIN_SYNC_CONTRACTS=asteroid,crewmate  # Which NFT contracts to track on-chain
```

### 3.2 Config Changes

**File: `config/default.json`** — Add:
```json
{
  "GameMode": {
    "mode": "chain",
    "chainSyncContracts": ["asteroid", "crewmate"]
  }
}
```

**File: `config/custom-environment-variables.json`** — Add:
```json
{
  "GameMode": {
    "mode": "GAME_MODE"
  }
}
```

### 3.3 Mode Helper

**New file: `src/common/lib/gameMode.js`**
```js
const appConfig = require('config');

const MODES = { CHAIN: 'chain', HYBRID: 'hybrid' };

const getMode = () => appConfig.get('GameMode.mode') || MODES.CHAIN;
const isHybrid = () => getMode() === MODES.HYBRID;
const isChain = () => getMode() === MODES.CHAIN;
const getSyncContracts = () => appConfig.get('GameMode.chainSyncContracts') || [];

module.exports = { MODES, getMode, isHybrid, isChain, getSyncContracts };
```

### 3.4 Rate Limit Adjustment

The existing rate limiter (`src/api/server.js`, lines 27-35) allows 50 requests per 10 seconds per user. In chain mode this is fine — game actions go to Starknet, so the API only handles reads. In hybrid mode, every game action is a `POST /v2/actions/:action`, so a player doing a quick sequence (plan → start → station → extract → process) can easily exceed 5/sec.

**File: `src/api/server.js`** — Use a higher limit in hybrid mode:

```js
const { isHybrid } = require('@common/lib/gameMode');

server.use(ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 10000,
  errorMessage: 'API is rate-limited',
  id: (ctx) => ((ctx.state.user && ctx.state.user.sub) ? ctx.state.user.sub : ctx.ip),
  max: isHybrid() ? 200 : 50,  // hybrid: 20/sec, chain: 5/sec
  whitelist: isWhiteList
}));
```

The limit is raised (not removed) — a buggy or malicious client can still be throttled, but normal gameplay won't trip the limiter.

---

## 4. Phase 2: Selective Event Pipeline

### 4.1 Key Insight: Contract Address Architecture

On Starknet, the Dispatcher contract is a single contract that emits **all** game action events (construction, mining, trading, transit, etc.) **and** all component update events. The NFT ownership events (Transfer, Bridge) come from separate per-token contracts (asteroid, crewmate, crew, ship, sway).

The retriever's `pullAndFormatEvents()` method queries the Starknet RPC with a list of contract addresses drawn from `StarknetEventConfig`:

```js
// src/common/lib/events/retrievers/starknet/retriever.js, line 161
addresses: StarknetEventConfig.toArray().map(({ address }) => address),
```

`StarknetEventConfig` (`src/common/lib/events/retrievers/starknet/config.js`) registers these contracts:
- `Contracts.starknet.asteroid` → Asteroid handlers (Transfer, Bridge)
- `Contracts.starknet.crewmate` → Crewmate handlers (Transfer, Bridge)
- `Contracts.starknet.crew` → Crew handlers (Transfer, Bridge)
- `Contracts.starknet.dispatcher` → Dispatcher handlers (**all game events + component updates**)
- `Contracts.starknet.ship` → Ship handlers (Transfer, marketplace)
- `Contracts.starknet.sway` → Sway handlers (withdrawals)

### 4.2 Retriever-Level Filtering (Primary Filter)

The correct place to filter is at the retriever config level — don't even fetch events from contracts we don't need. This avoids storing thousands of irrelevant Dispatcher events in MongoDB.

**File: `src/common/lib/events/retrievers/starknet/config.js`**

In hybrid mode, only register the asteroid and crewmate contracts:

```js
const { isHybrid } = require('@common/lib/gameMode');

let ADDRESS_NAME_MAP;

if (isHybrid()) {
  // Only track NFT ownership events from asteroid and crewmate contracts
  ADDRESS_NAME_MAP = {
    [STARKNET_CONTRACT_ASTEROID]: handlers.Asteroid,
    [STARKNET_CONTRACT_CREWMATE]: handlers.Crewmate
  };
} else {
  ADDRESS_NAME_MAP = {
    [STARKNET_CONTRACT_ASTEROID]: handlers.Asteroid,
    [STARKNET_CONTRACT_CREW]: handlers.Crew,
    [STARKNET_CONTRACT_CREWMATE]: handlers.Crewmate,
    [STARKNET_CONTRACT_DISPATCHER]: handlers.Dispatcher,
    [STARKNET_CONTRACT_SHIP]: handlers.Ship,
    [STARKNET_CONTRACT_SWAY]: handlers.Sway
  };
}
```

This means:
- `pullAndFormatEvents()` only passes asteroid + crewmate addresses to `getEvents`
- The Starknet RPC only returns Transfer/Bridge events from those two contracts
- No Dispatcher events are ever fetched or stored
- No changes needed to the retriever itself

### 4.3 Processor-Level Safety Guard (Belt and Suspenders)

Even with the retriever filter, add a defensive check in the processor. This catches edge cases like:
- Manually imported events (via `bin/updateEvents.js`)
- Events from a previous chain-mode run that are still unprocessed in MongoDB
- The synthetic events created by the game logic engine (which are pre-marked as `lastProcessed`)

**File: `src/common/lib/events/processor/EventProcessor.js`**

```js
const { isHybrid } = require('@common/lib/gameMode');
const STARKNET_CONTRACT_DISPATCHER = appConfig.get('Contracts.starknet.dispatcher');

async process({ events }) {
  return eachSeries(events, async (event) => {
    const { address, event: eventName } = event;

    // In hybrid mode, skip ALL dispatcher events.
    // The dispatcher is a single contract address that emits every game action event.
    // Ownership events (Transfer, Bridge) come from separate NFT contracts.
    //
    // Note: `handler` is not constructed until after this check (line 30 in the
    // original code), so we mark lastProcessed directly on the event document.
    if (isHybrid() && Address.toStandard(address) === Address.toStandard(STARKNET_CONTRACT_DISPATCHER)) {
      event.set('lastProcessed', new Date());
      await event.save();
      return;
    }

    // ... existing handler lookup and processing (constructs handler on next line)
  });
}
```

Note: this guard runs before the handler is constructed. It skips by contract address, not event name — every event from the dispatcher address is a game action. Synthetic events from the game logic engine are already pre-marked with `lastProcessed` (Section 6.3), so the processor's `getNonProcessed()` query never picks them up in the first place.

### 4.4 Workers — Conditional Startup

**File: `src/workers/eventRetriever.js`**

```js
// Ethereum retriever is fully disabled in hybrid mode (no L1 contracts to track)
if (isHybrid() && args.eventSource === 'ethereum') {
  logger.info('Ethereum retriever disabled in hybrid mode');
  process.exit(0);
}
```

The Starknet retriever still runs, but with the filtered config from 4.2 it only polls asteroid and crewmate contracts.

**File: `src/workers/starknetEventAuditor.js`**

```js
// Auditor disabled in hybrid mode (no dispatcher events to audit)
if (isHybrid()) {
  logger.info('Starknet event auditor disabled in hybrid mode');
  process.exit(0);
}
```

**Workers status by mode:**

| Worker | Chain Mode | Hybrid Mode |
|--------|-----------|-------------|
| `eventRetriever` (ethereum) | runs | **disabled** |
| `eventRetriever` (starknet) | runs (all contracts) | runs (**asteroid + crewmate only**) |
| `eventProcessor` | runs (all events) | runs (**dispatcher events skipped**) |
| `elasticsearch` | runs | runs |
| `nftCardBuilder` | runs | runs |
| `starknetEventAuditor` | runs | **disabled** |
| `notifications` | runs | runs |

### 4.5 Procfile / ecosystem.config.js Updates

No changes needed — disabled workers exit cleanly on startup.

### 4.6 Synthetic Events and the Processor

The game logic engine (Phase 4) creates synthetic Event documents in MongoDB for its write path. These are pre-marked with `lastProcessed: new Date()` so the EventProcessor's query for unprocessed events (`EventService.getNonProcessed()`) will never pick them up. They exist only to satisfy the `ComponentService.updateOrCreateFromEvent()` requirement for a real Event reference. The processor never sees them.

---

## 5. Phase 3: Game Action API Endpoints

### 5.1 New Action Controller

**New file: `src/api/controllers/actions.js`**

This controller accepts game action requests and routes them to the game logic engine. It only mounts in hybrid mode.

```js
// POST /v2/actions/:action
// Body: { callerCrew: { id, label }, vars: { ... }, meta: { ... } }
// Headers: X-Idempotency-Key (optional) — client-generated unique key for crash safety
// Auth: JWT required (wallet address extracted from token)

const executeAction = async (ctx) => {
  const { params: { action }, request: { body }, state: { user: { sub: address } } } = ctx;
  const idempotencyKey = ctx.get('X-Idempotency-Key') || null;
  
  try {
    const result = await GameEngine.execute({
      action,
      address,
      callerCrew: body.callerCrew,
      vars: body.vars,
      meta: body.meta,
      idempotencyKey
    });
    
    ctx.status = 200;
    ctx.body = result;
  } catch (error) {
    if (error.code === 112 || error.codeName === 'WriteConflict') {
      ctx.status = 409;
      ctx.body = { error: 'Conflict — retry the action', retryable: true };
    } else if (error.name === 'ValidationError') {
      ctx.status = 400;
      ctx.body = { error: error.message };
    } else {
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  }
};
```

**Error status codes:**
- **400** — Validation failure (bad input, insufficient resources, permission denied)
- **409** — WriteConflict from transaction abort (TOCTOU contention) — client should retry
- **500** — Unexpected internal error

### 5.2 Actions to Support

Based on the Starknet contract systems (`influence-starknet/src/systems/`) and the client's `MockTransactionManager`, these are the game actions to implement, grouped by priority:

**Priority 1 — Core Gameplay Loop (matches tutorial simulation):**
| Action | Starknet System | State Changes |
|--------|----------------|---------------|
| `AcceptPrepaidAgreement` | `agreements/accept_prepaid.cairo` | Creates PrepaidAgreement on Lot |
| `ConstructionPlan` | `construction/plan.cairo` | Creates Building entity (PLANNED), sets Location |
| `ConstructionStart` | `construction/start.cairo` | Updates Building status → UNDER_CONSTRUCTION, consumes materials from Inventory |
| `ConstructionFinish` | `construction/finish.cairo` | Updates Building status → OPERATIONAL (time-gated) |
| `SampleDepositStart` | `deposits/sample_start.cairo` | Creates Deposit entity, consumes Core Drill |
| `SampleDepositFinish` | `deposits/sample_finish.cairo` | Sets Deposit yield (time-gated) |
| `ExtractResourceStart` | `production/extract_start.cairo` | Sets Extractor → RUNNING, calculates yield/finish time |
| `ExtractResourceFinish` | `production/extract_finish.cairo` | Moves product to Inventory, Extractor → IDLE (time-gated) |
| `ProcessProductsStart` | `production/process_start.cairo` | Consumes inputs, Processor → RUNNING |
| `ProcessProductsFinish` | `production/process_finish.cairo` | Produces outputs, Processor → IDLE (time-gated) |
| `StationCrew` | `crew/station.cairo` | Updates Crew Location component |

**Priority 2 — Trading & Marketplace:**
| Action | State Changes |
|--------|---------------|
| `CreateSellOrder` | Creates Order entity, moves product from Inventory to escrow |
| `CreateBuyOrder` | Creates Order entity, reserves SWAY |
| `FillSellOrder` | Transfers product to buyer Inventory, transfers SWAY to seller |
| `FillBuyOrder` | Transfers product to buyer, releases SWAY |
| `CancelSellOrder` | Returns product to Inventory, removes Order |
| `CancelBuyOrder` | Returns SWAY, removes Order |

**Priority 3 — Ships & Transit:**
| Action | State Changes |
|--------|---------------|
| `AssembleShipStart` | Consumes components, DryDock → RUNNING, creates Ship entity |
| `AssembleShipFinish` | DryDock → IDLE, Ship → AVAILABLE (time-gated) |
| `DockShip` | Updates Ship/Dock Location, Dock component |
| `UndockShip` | Updates Ship Location (asteroid orbit level) |
| `TransitBetweenStart` | Ship in transit, calculates arrival time, consumes propellant |
| `TransitBetweenFinish` | Ship arrives at destination (time-gated) |

**Priority 4 — Crew Management:**
| Action | State Changes |
|--------|---------------|
| `FormCrew` | Creates Crew entity |
| `ArrangeCrew` | Updates Crew.roster |
| `DelegateCrew` | Updates Crew.delegatedTo |
| `EjectCrew` | Removes Crew from location |
| `RecruitCrewmate` | Creates Crewmate entity |

**Priority 5 — Scanning & Deposits:**
| Action | Dispatcher Event | State Changes |
|--------|-----------------|---------------|
| `SurfaceScanStart` | `SurfaceScanStarted` | Consumes scanner from Inventory, sets scan in progress (time-gated) |
| `SurfaceScanFinish` | `SurfaceScanFinished` | Reveals lot resource data for asteroid |
| `ResourceScanStart` | `ResourceScanStarted` | Consumes scanner from Inventory, sets scan in progress (time-gated) |
| `ResourceScanFinish` | `ResourceScanFinished` | Reveals deposit details at lot |
| `ListDepositForSale` | `DepositListedForSale` | Sets deposit sale price |
| `UnlistDepositForSale` | `DepositUnlistedForSale` | Removes deposit sale listing |
| `PurchaseDeposit` | `DepositPurchased` | Transfers deposit ownership, moves SWAY |

**Priority 6 — Agreements, Policies, Whitelist:**
| Action | Dispatcher Event | State Changes |
|--------|-----------------|---------------|
| `AcceptContractAgreement` | `ContractAgreementAccepted` | Creates ContractAgreement |
| `CancelPrepaidAgreement` | `PrepaidAgreementCancelled` | Removes PrepaidAgreement |
| `ExtendPrepaidAgreement` | `PrepaidAgreementExtended` | Updates PrepaidAgreement.endTime |
| `TransferPrepaidAgreement` | `PrepaidAgreementTransferred` | Transfers agreement to new party |
| `LeaseLot` | `LotLeased` | Creates lease agreement on lot |
| `AssignPublicPolicy` | `PublicPolicyAssigned` | Updates PublicPolicy component |
| `RemovePublicPolicy` | `PublicPolicyRemoved` | Removes PublicPolicy component |
| `AssignPrepaidPolicy` | `PrepaidPolicyAssigned` | Updates PrepaidPolicy component |
| `RemovePrepaidPolicy` | `PrepaidPolicyRemoved` | Removes PrepaidPolicy component |
| `AssignContractPolicy` | `ContractPolicyAssigned` | Updates ContractPolicy component |
| `AddToWhitelist` | `AddedToWhitelist` / `AddedAccountToWhitelist` | Adds entity/account to WhitelistAgreement |
| `RemoveFromWhitelist` | `RemovedFromWhitelist` / `RemovedAccountFromWhitelist` | Removes from WhitelistAgreement |

**Priority 7 — Deliveries (full lifecycle):**
| Action | Dispatcher Event | State Changes |
|--------|-----------------|---------------|
| `SendDelivery` | `DeliverySent` | Creates Delivery entity, moves product from Inventory |
| `StartDelivery` | `DeliveryStarted` | Delivery in transit (time-gated) |
| `PackageDelivery` | `DeliveryPackaged` | Packages delivery for transport |
| `ReceiveDelivery` | `DeliveryReceived` | Moves product to recipient Inventory |
| `FinishDelivery` | `DeliveryFinished` | Completes delivery lifecycle |
| `CancelDelivery` | `DeliveryCancelled` | Returns product to sender |
| `DumpDelivery` | `DeliveryDumped` | Discards delivery contents |

**Priority 8 — Misc:**
| Action | Dispatcher Event | State Changes |
|--------|-----------------|---------------|
| `ChangeName` | `NameChanged` | Updates Name component |
| `ConstructionDeconstruct` | `ConstructionDeconstructed` | Returns materials (with penalty), removes Building |
| `ConstructionAbandon` | `ConstructionAbandoned` | Removes planned Building |
| `ManageAsteroid` | `AsteroidManaged` | Updates asteroid permissions |
| `AnnotateEvent` | `EventAnnotated` | Creates EventAnnotation |
| `DirectMessage` | `DirectMessageSent` | Creates DirectMessage |
| `ConfigureExchange` | `ExchangeConfigured` | Updates Exchange component |
| `ReclaimLot` | `LotReclaimed` | Reclaims lot from expired agreement |
| `RepossessBuilding` | `BuildingRepossessed` | Transfers building control |
| `TransferCrewmate` | `CrewmateTransferred` | Transfers crewmate between crews |
| `ExchangeCrewmates` | `CrewmatesExchanged` | Swaps crewmates between crews |
| `ResupplyFood` | `FoodSupplied` | Consumes Food from Inventory, updates Crew.lastFed |
| `CommandeerShip` | `ShipCommandeered` | Forcibly takes control of a ship |
| `CollectEmergencyPropellant` | `EmergencyPropellantCollected` | Emergency propellant from ship |
| `ActivateEmergency` | `EmergencyActivated` | Activates emergency mode |
| `DeactivateEmergency` | `EmergencyDeactivated` | Deactivates emergency mode |
| `RekeyInbox` | `RekeyedInbox` | Updates direct messaging encryption keys |
| `ResolveRandomEvent` | `RandomEventResolved` | Resolves a random game event |
| `OfferPrivateSale` | `PrivateSaleOffered` | Creates a private sale listing |
| `AcceptPrivateSale` | `PrivateSaleAccepted` | Accepts a private sale |
| `RemovePrivateSale` | `PrivateSaleRemoved` | Removes a private sale listing |
| `OfferSale` | `SaleOffered` | Creates a public sale listing |
| `CreateOrder` | `OrderCreated` | Creates an order (generic) |

**Explicitly excluded — not applicable to hybrid mode:**
| Dispatcher Event | Reason for Exclusion |
|-----------------|---------------------|
| `AsteroidInitialized` | One-time chain bootstrap event — asteroids exist from genesis data |
| `AsteroidPurchased` | Primary sale from the game studio — not a player action |
| `CrewmatePurchased` | Primary sale from the game studio — not a player action |
| `TestnetSwayClaimed` | Testnet-only faucet — hybrid server manages SWAY balances directly |
| `ArrivalRewardClaimed` | Chain-specific promotional reward |
| `EarlyAdopterRewardClaimed` | Chain-specific promotional reward |
| `PrepareForLaunchRewardClaimed` | Chain-specific promotional reward |
| `ConstantRegistered` | Chain-level constant registration — hybrid server sets constants directly |

### 5.3 Mount in Server

The existing server mounts controllers by iterating over the `controllers` index object:

```js
// src/api/server.js, lines 46-50
if (Number(appConfig.get('App.isApiServer')) === 1) {
  Object.entries(controllers).forEach(([name, router]) => {
    if (name !== 'images') server.use((router.router || router).routes());
  });
}
```

So the actions controller must follow the same pattern: export a koa-router from the controllers index. The mode gating happens **inside the controller** — in chain mode it exports an empty router (no routes registered), so the server loop picks it up but it matches nothing.

**File: `src/api/controllers/actions.js`**

```js
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const { allowedOrigin } = require('@api/plugins/origin');
const { isHybrid } = require('@common/lib/gameMode');
const GameEngine = require('@common/gameLogic/GameEngine');

const router = new KoaRouter()
  .use(cors({ origin: allowedOrigin }));

// Only register action routes in hybrid mode.
// In chain mode this exports an empty router — the server loop still
// iterates it, but it has no routes so it matches nothing.
if (isHybrid()) {
  router.post('/v2/actions/:action', async (ctx) => {
    const { params: { action }, request: { body }, state: { user: { sub: address } } } = ctx;
    const idempotencyKey = ctx.get('X-Idempotency-Key') || null;

    try {
      const result = await GameEngine.execute({
        action,
        address,
        callerCrew: body.callerCrew,
        vars: body.vars,
        meta: body.meta,
        idempotencyKey
      });

      ctx.status = 200;
      ctx.body = result;
    } catch (error) {
      if (error.code === 112 || error.codeName === 'WriteConflict') {
        ctx.status = 409;
        ctx.body = { error: 'Conflict — retry the action', retryable: true };
      } else if (error.name === 'ValidationError') {
        ctx.status = 400;
        ctx.body = { error: error.message };
      } else {
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
    }
  });
}

module.exports = router;
```

**File: `src/api/controllers/index.js`** — Add to imports and exports:
```js
const actions = require('./actions');
// ... in module.exports:
actions,
```

**No changes to `src/api/server.js`.** The existing iteration loop picks up the new controller automatically.

---

## 6. Phase 4: Game Logic Engine

This is the core new code. It validates and executes game actions locally, replacing the Starknet contracts.

### 6.1 Key Architectural Insight: Reuse Existing Dispatcher Handlers

**The existing event pipeline already has handlers that perform all side effects correctly.**
On-chain, each game action emits multiple events — one system event (e.g., `ConstructionPlanned`)
plus several `ComponentUpdated` events (one per component changed). The server has separate
handlers for each:

- **System handlers** (`Dispatcher/systems/ConstructionPlanned.js`) — create Activity records,
  emit Socket.IO messages, update PackedLotData, create notifications, flag NFT cards, etc.
- **Component handlers** (`Dispatcher/components/Building.js`, `Location.js`, `Control.js`, etc.) —
  call `ComponentService.updateOrCreateFromEvent()` to write the actual data, queue ES indexing

**Rather than reimplementing all these side effects from scratch**, the hybrid action handlers
should create synthetic Event documents and then **run the existing Dispatcher handlers** as
post-action hooks. This guarantees side-effect parity with chain mode and eliminates an entire
class of "missed side effect" bugs.

**Hybrid action flow (two-phase commit):**
```
Phase 1 — Transaction (validate + write):
  Action Handler
    → validate (read-only checks, within transaction session)
    → create synthetic Event docs (system + component events)
    → write components (via ComponentService.updateOrCreateFromEvent)
    → COMMIT

Phase 2 — Side effects (non-transactional, reads committed data):
  Existing Dispatcher system handler
    → reads component data from MongoDB (committed in Phase 1)
    → creates Activity record
    → creates notifications (resolvable events, crew ready, etc.)
    → updates PackedLotData
    → flags NFT cards for re-render
    → collects Socket.IO messages
  → emit socket events
```

Phase 2 runs the existing Dispatcher system handler — NOT the component handlers
(the action handler already wrote components in Phase 1). The two-phase split is
necessary because the Dispatcher handlers use session-less DB reads (EntityService
aggregations, LocationComponentService lookups) that can't see uncommitted writes
from a transaction. This matches the real pipeline: events are committed by the
retriever, then processed by the EventProcessor.

### 6.2 Critical Constraint: The Write Path

**The existing write path requires real Event documents:**

- Every component stores an `event` reference: `{ id: ObjectId, timestamp: Number }`.
- `ComponentService.updateOrCreateFromEvent()` is the **only** write method. Requires a full
  Event document with `_id`, `timestamp`, `blockNumber`, `transactionIndex`, `logIndex`, `__t`.
- Uses ordering comparisons (blockNumber > transactionIndex > logIndex) to reject stale events.
- `ActivityService.findOrCreateOne()` requires `event instanceof mongoose.model('Event')`.

Both the component writes and the system handler reuse need real Event documents.
The SyntheticEvent factory (Section 6.3) satisfies this.

### 6.3 Synthetic Event Factory

The action handler needs to mint a real `Event` (Starknet discriminator) document in MongoDB for each action. This event won't come from the chain — it's locally generated — but it's structurally identical.

**New file: `src/common/gameLogic/helpers/syntheticEvent.js`**

```js
const mongoose = require('mongoose');

// Monotonically increasing counters to guarantee ordering within a local session.
// Mirrors the blockNumber > transactionIndex > logIndex ordering that
// ComponentService.updateOrCreateFromEvent() uses to reject stale writes.
let _blockCounter = 0;
let _txCounter = 0;
let _logCounter = 0;

class SyntheticEvent {
  /**
   * Creates and persists a real Starknet Event document in MongoDB.
   * The resulting doc has a valid _id, __t, timestamp, blockNumber,
   * transactionIndex, logIndex — everything ComponentService needs.
   *
   * @param {string} eventName - e.g. 'ConstructionPlanned'
   * @param {object} returnValues - the decoded event payload
   * @param {object[]} entities - array of { id, label } touched by this event
   * @returns {Document} a saved Mongoose Event (Starknet discriminator) document
   */
  /**
   * Look up the event key hash from the Dispatcher system handler's eventConfig.
   * This is the keccak256 of the event name, used by the handler routing and
   * included in on-chain events. Clients may inspect this field.
   */
  static _getEventKeys(eventName) {
    try {
      const systemHandlers = require('@common/lib/events/handlers/starknet/Dispatcher/systems');
      const handler = systemHandlers[eventName];
      if (handler?.eventConfig?.keys) return handler.eventConfig.keys;
    } catch (e) { /* fall through */ }
    return [];
  }

  /**
   * Checks if an action with this idempotency key has already been executed.
   * Returns the existing synthetic event if found, null otherwise.
   */
  static async findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const StarknetEvent = mongoose.model('Starknet');
    return StarknetEvent.findOne({ idempotencyKey }).lean();
  }

  static async create({ eventName, returnValues, transactionHash, session, idempotencyKey }) {
    const StarknetEvent = mongoose.model('Starknet'); // discriminator of Event

    const now = Math.floor(Date.now() / 1000);
    _blockCounter++;
    _txCounter++;

    const event = new StarknetEvent({
      address: 'local-hybrid-server',
      blockHash: `0xlocal_block_${_blockCounter}`,
      blockNumber: 9_000_000_000 + _blockCounter, // high offset to never collide with real blocks
      event: eventName,
      name: eventName,
      keys: this._getEventKeys(eventName),  // keccak256 hash(es) matching the Dispatcher handler
      logIndex: 0,
      returnValues,
      timestamp: now,
      transactionHash: transactionHash || this._generateTxHash(),
      transactionIndex: _txCounter,
      ...(idempotencyKey && { idempotencyKey }),
      status: 'ACCEPTED_ON_L2',
      lastProcessed: new Date()  // mark as already processed so the EventProcessor skips it
    });

    await event.save({ session });  // participates in the Phase 1 transaction
    return event;
  }

  /**
   * Creates additional synthetic events for component updates within the same
   * "transaction" (same txHash, incrementing logIndex). This preserves ordering
   * guarantees when multiple components are written for one action.
   */
  static async createComponentEvent({ parentEvent, componentName, returnValues, session }) {
    const StarknetEvent = mongoose.model('Starknet');
    _logCounter++;

    const event = new StarknetEvent({
      address: 'local-hybrid-server',
      blockHash: parentEvent.blockHash,
      blockNumber: parentEvent.blockNumber,
      event: `ComponentUpdated_${componentName}`,
      name: `ComponentUpdated_${componentName}`,
      logIndex: _logCounter,
      returnValues,
      timestamp: parentEvent.timestamp,
      transactionHash: parentEvent.transactionHash,
      transactionIndex: parentEvent.transactionIndex,
      status: 'ACCEPTED_ON_L2',
      lastProcessed: new Date()
    });

    await event.save({ session });
    return event;
  }

  static _generateTxHash() {
    return `0x${require('crypto').randomBytes(31).toString('hex')}`;
  }
}

module.exports = SyntheticEvent;
```

### 6.4 Directory Structure

```
src/common/gameLogic/
├── GameEngine.js              # Main entry point — routes actions to handlers
├── helpers/
│   ├── syntheticEvent.js      # Creates real Event documents for the write path
│   ├── idGenerator.js         # Generates unique entity IDs (replaces on-chain ID assignment)
│   ├── timeAcceleration.js    # Game time calculations (uses @influenceth/sdk Time)
│   ├── modifiers.js           # Crew/building efficiency modifiers
│   └── (removed — replaced by forkWorld.js worker + WorldFork model)
├── validators/
│   ├── access.js              # Permission checking (mirrors influence-starknet/src/common/access.cairo)
│   ├── crew.js                # Crew readiness, food, delegation checks
│   ├── inventory.js           # Mass/volume capacity, product availability
│   ├── location.js            # Entity co-location validation
│   └── stateMachine.js        # Equipment status transitions (IDLE → RUNNING → IDLE)
├── handlers/
│   ├── BaseActionHandler.js   # Base class with common patterns
│   ├── construction/
│   │   ├── plan.js
│   │   ├── start.js
│   │   ├── finish.js
│   │   ├── deconstruct.js
│   │   └── abandon.js
│   ├── production/
│   │   ├── extractStart.js
│   │   ├── extractFinish.js
│   │   ├── processStart.js
│   │   ├── processFinish.js
│   │   ├── assembleShipStart.js
│   │   └── assembleShipFinish.js
│   ├── crew/
│   │   ├── station.js
│   │   ├── form.js
│   │   ├── arrange.js
│   │   ├── delegate.js
│   │   ├── eject.js
│   │   ├── recruit.js
│   │   ├── resupplyFood.js
│   │   ├── transferCrewmate.js
│   │   └── exchangeCrewmates.js
│   ├── scanning/
│   │   ├── surfaceScanStart.js
│   │   ├── surfaceScanFinish.js
│   │   ├── resourceScanStart.js
│   │   └── resourceScanFinish.js
│   ├── deposits/
│   │   ├── sampleStart.js
│   │   ├── sampleFinish.js
│   │   ├── sampleImprove.js
│   │   ├── listForSale.js
│   │   ├── unlistForSale.js
│   │   └── purchase.js
│   ├── orders/
│   │   ├── createSellOrder.js
│   │   ├── createBuyOrder.js
│   │   ├── createOrder.js
│   │   ├── fillSellOrder.js
│   │   ├── fillBuyOrder.js
│   │   ├── cancelSellOrder.js
│   │   └── cancelBuyOrder.js
│   ├── ship/
│   │   ├── dock.js
│   │   ├── undock.js
│   │   ├── transitStart.js
│   │   ├── transitFinish.js
│   │   └── commandeer.js
│   ├── deliveries/
│   │   ├── send.js
│   │   ├── start.js
│   │   ├── package.js
│   │   ├── receive.js
│   │   ├── finish.js
│   │   ├── cancel.js
│   │   └── dump.js
│   ├── agreements/
│   │   ├── acceptPrepaid.js
│   │   ├── cancelPrepaid.js
│   │   ├── extendPrepaid.js
│   │   ├── transferPrepaid.js
│   │   ├── acceptContract.js
│   │   └── leaseLot.js
│   ├── policies/
│   │   ├── assignPublic.js
│   │   ├── removePublic.js
│   │   ├── assignPrepaid.js
│   │   ├── removePrepaid.js
│   │   └── assignContract.js
│   ├── whitelist/
│   │   ├── addToWhitelist.js
│   │   ├── removeFromWhitelist.js
│   │   ├── addAccountToWhitelist.js
│   │   └── removeAccountFromWhitelist.js
│   ├── sales/
│   │   ├── offerPrivateSale.js
│   │   ├── acceptPrivateSale.js
│   │   ├── removePrivateSale.js
│   │   └── offerSale.js
│   ├── emergency/
│   │   ├── activate.js
│   │   ├── deactivate.js
│   │   └── collectPropellant.js
│   └── misc/
│       ├── changeName.js
│       ├── manageAsteroid.js
│       ├── configureExchange.js
│       ├── annotateEvent.js
│       ├── directMessage.js
│       ├── rekeyInbox.js
│       ├── reclaimLot.js
│       ├── repossessBuilding.js
│       └── resolveRandomEvent.js
```

### 6.5 GameEngine.js — Two-Phase Execution

**The problem with a single transaction:** The plan reuses existing Dispatcher
handlers for side effects (Activity, Socket.IO, PackedLotData, etc.). But these
handlers make DB reads (EntityService.getEntity, LocationComponentService.findOneByEntity,
etc.) that use aggregation pipelines with no session. Under MongoDB's snapshot isolation,
session-less reads **cannot see uncommitted writes from the transaction**. If we wrap
everything in one transaction, the Dispatcher handler can't read the components that
`applyStateChanges()` just wrote.

This is the same constraint as the real pipeline: the retriever persists events first,
then the processor runs handlers against committed data.

**Solution: Two-phase commit.** Phase 1 validates and writes components in a transaction
(ensuring atomicity and TOCTOU protection). Phase 2 runs the Dispatcher handler against
committed data (no transaction needed — reads can see the committed writes).

```js
const mongoose = require('mongoose');

class GameEngine {
  static handlers = {
    'ConstructionPlan': require('./handlers/construction/plan'),
    'ConstructionStart': require('./handlers/construction/start'),
    'ConstructionFinish': require('./handlers/construction/finish'),
    // ... all other actions
  };

  static async execute({ action, address, callerCrew, vars, meta, idempotencyKey }) {
    // ── Idempotency check ────────────────────────────────────────────
    // If the client provided an idempotency key, check whether this action
    // has already been executed. This handles the crash-between-commit-and-
    // response case: the client retries with the same key and gets the
    // previous result instead of a double-execution.
    if (idempotencyKey) {
      const existing = await SyntheticEvent.findByIdempotencyKey(idempotencyKey);
      if (existing) return { event: existing, replayed: true };
    }

    const HandlerClass = this.handlers[action];
    if (!HandlerClass) throw new Error(`Unknown action: ${action}`);

    const handler = new HandlerClass({ action, address, callerCrew, vars, meta, idempotencyKey });

    // ── Phase 1: Validate + Write (transactional) ────────────────────
    // Wraps validate() + applyStateChanges() in a MongoDB transaction.
    // This closes the TOCTOU window: reads during validate() and writes
    // during applyStateChanges() share the same session. Concurrent
    // modifications to the same documents cause a WriteConflict on commit.
    const session = await mongoose.startSession();
    let result;

    try {
      session.startTransaction();
      handler.setSession(session);

      // 1a. Validate (reads use the session's snapshot)
      await handler.validate();

      // 1b. Create synthetic event + write components
      result = await handler.writePhase();

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // ── Phase 2: Side effects (non-transactional) ────────────────────
    // Run the existing Dispatcher system handler against the committed data.
    // The handler's DB reads (EntityService, LocationComponentService, etc.)
    // can now see the component data written in Phase 1.
    //
    // NOTE: EntityService.getEntities() has a hidden write side effect —
    // when called with id/label or uuid, it does Entity.updateOne({ uuid },
    // data, { upsert: true }) on EVERY query (Entity.js lines 59-61).
    // This runs without a session. For entities created in Phase 1 by
    // createEntityWithComponents(), the upsert is a harmless no-op. For
    // entities that already existed (e.g., callerCrew), it's also a no-op.
    // Be aware of this if debugging unexpected Entity writes.
    //
    // This matches the real pipeline: events are persisted first (by the
    // retriever), then processed (by the EventProcessor). If Phase 2 fails,
    // component data is committed but side effects are incomplete — same
    // risk as the real pipeline when the processor crashes mid-event.
    try {
      await handler.sideEffectPhase();
    } catch (error) {
      // Log but don't throw — component data is already committed.
      // Side effects can be retried by re-running the Dispatcher handler
      // against the synthetic event (same as the processor retries).
      logger.error(`Side effect phase failed for ${action}:`, error);
    }

    // 3. Emit Socket.IO events — always after both phases complete
    await handler.emitEvents();

    return result;
  }
}
```

**If Phase 2 fails:** Component data is committed (game state is correct), but
Activity records, notifications, or PackedLotData may be missing. This is recoverable:
the synthetic event exists in MongoDB, and the Dispatcher handler can be re-run against
it — same pattern as the EventProcessor retrying failed events. A background job can
sweep for synthetic events whose corresponding Activity records don't exist.

### 6.6 BaseActionHandler.js

The base class splits execution into two phases matching GameEngine's two-phase
commit. Phase 1 (transactional) creates synthetic events and writes components.
Phase 2 (non-transactional) runs the existing Dispatcher handler for side effects
against committed data.

```js
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const SyntheticEvent = require('../helpers/syntheticEvent');
const { ComponentService, ElasticSearchService } = require('@common/services');

class BaseActionHandler {
  constructor({ action, address, callerCrew, vars, meta }) {
    this.action = action;
    this.address = address;
    this.callerCrew = callerCrew;
    this.vars = vars;
    this.meta = meta;

    this.systemEvent = null;        // synthetic Event document
    this.session = null;            // MongoDB session (Phase 1 only)
    this._dispatcherHandler = null; // existing Dispatcher handler (Phase 2)
  }

  /**
   * Called by GameEngine to inject the MongoDB session for Phase 1.
   */
  setSession(session) {
    this.session = session;
  }

  // Override in subclasses
  async validate() { throw new Error('Must implement validate()'); }
  async applyStateChanges() { throw new Error('Must implement applyStateChanges()'); }
  getEventName() { throw new Error('Must implement getEventName()'); }
  getReturnValues() { throw new Error('Must implement getReturnValues()'); }

  /**
   * Return the existing Dispatcher system handler class for this action.
   * @returns {Class} e.g., require('...Dispatcher/systems/ConstructionPlanned')
   */
  getDispatcherSystemHandler() { throw new Error('Must implement getDispatcherSystemHandler()'); }

  // ── Phase 1: Write (runs inside transaction) ──────────────────────

  /**
   * Called by GameEngine inside the transaction. Creates synthetic events
   * and writes components. All DB operations use this.session.
   */
  async writePhase() {
    // Create the system-level synthetic event. This must happen inside
    // the transaction so it's rolled back if component writes fail.
    this.systemEvent = await SyntheticEvent.create({
      eventName: this.getEventName(),
      returnValues: this.getReturnValues(),
      session: this.session
    });

    // Write components — subclass responsibility
    return this.applyStateChanges();
  }

  // ── Phase 2: Side effects (runs after transaction commit) ─────────

  /**
   * Called by GameEngine AFTER the transaction commits. Runs the existing
   * Dispatcher system handler against the synthetic event. The handler's
   * DB reads (EntityService, LocationComponentService, etc.) can now see
   * the committed component data from Phase 1.
   *
   * This mirrors the real pipeline: the retriever commits events first,
   * then the EventProcessor runs handlers against committed data.
   */
  async sideEffectPhase() {
    const HandlerClass = this.getDispatcherSystemHandler();
    this._dispatcherHandler = new HandlerClass(this.systemEvent);
    await this._dispatcherHandler.processEvent();
    await this._dispatcherHandler.finalizeEvent();
  }

  /**
   * Emit Socket.IO events collected by the Dispatcher handler.
   * Called by GameEngine after sideEffectPhase() completes.
   */
  async emitEvents() {
    if (this._dispatcherHandler) {
      await this._dispatcherHandler.emitSocketEvents();
    }
  }

  // ── Component write methods ────────────────────────────────────────

  /**
   * Create an Entity document directly in the Entity collection.
   * Uses mongoose.model('Entity').updateOne() with upsert — same pattern
   * as the entitiesPlugin but explicit and intentional.
   */
  async createEntity(entityRef) {
    const entityData = Entity.toEntity(entityRef);
    await mongoose.model('Entity').updateOne(
      { uuid: entityData.uuid },
      entityData,
      { upsert: true, session: this.session }
    );
    return entityData;
  }

  /**
   * Create a new entity and all its initial components atomically.
   * Creates the Entity document first, then writes each component via
   * ComponentService.updateOrCreateFromEvent(). All operations use
   * this.session so they're part of the action's transaction.
   */
  async createEntityWithComponents(entityRef, components) {
    const entity = Entity.toEntity(entityRef);
    await mongoose.model('Entity').updateOne(
      { uuid: entity.uuid },
      entity,
      { upsert: true, session: this.session }
    );

    const componentResults = [];
    for (const { component, data, options } of components) {
      const componentEvent = await SyntheticEvent.createComponentEvent({
        parentEvent: this.systemEvent,
        componentName: component,
        returnValues: { ...data, entity },
        session: this.session
      });

      const result = await ComponentService.updateOrCreateFromEvent({
        component,
        event: componentEvent,
        data: { ...data, entity },
        replace: options?.replace !== false,
        session: this.session
      });

      if (result.updated) {
        await ElasticSearchService.queueEntityForIndexing(entity);
      }

      componentResults.push(result);
    }

    return { entity, componentResults };
  }

  /**
   * Write a single component. Use for updating existing entities
   * (e.g., changing Building status). For new entities, prefer
   * createEntityWithComponents().
   */
  async writeComponent(componentName, data, options = {}) {
    const componentEvent = await SyntheticEvent.createComponentEvent({
      parentEvent: this.systemEvent,
      componentName,
      returnValues: data,
      session: this.session
    });

    const result = await ComponentService.updateOrCreateFromEvent({
      component: componentName,
      event: componentEvent,
      data,
      replace: options.replace !== false,
      session: this.session
    });

    if (result.updated && data.entity) {
      await ElasticSearchService.queueEntityForIndexing(data.entity);
    }

    return result;
  }

  /**
   * Delete a component (for actions like ConstructionAbandon).
   */
  async deleteComponent(componentName, data, filter) {
    return ComponentService.deleteOne({ component: componentName, data, filter });
  }
}

module.exports = BaseActionHandler;
```

**Why this works:** The existing Dispatcher system handlers (e.g., `ConstructionPlanned.js`)
are constructed with a single argument — the event document — and their `processEvent()`
method reads component data from MongoDB (which our action handler just wrote) and creates
Activity records, Socket.IO messages, PackedLotData updates, notifications, etc. The
`EventProcessor` runs them the exact same way (line 30-33 of `EventProcessor.js`):

```js
const handler = new EventHandlerClass(event);
await handler.processEvent();
await handler.finalizeEvent();
await handler.emitSocketEvents();
```

Our synthetic event has the same `returnValues` structure the handler expects, and the
component data is already in MongoDB. The handler doesn't know or care that the event
didn't come from the chain.

**What this eliminates:** The action handler no longer needs to manually call
PackedLotDataService, NftComponentService, ResolvableEventNotificationService,
CrewReadyNotificationService, ActivityService.resolveStartActivity, or build
Socket.IO messages. All of these are handled by the existing Dispatcher handler.
If upstream adds new side effects to a Dispatcher handler, the hybrid flow
automatically picks them up.

### 6.7 Example Handler: Construction Plan

**Reference contracts:**
- Game logic: `influence-starknet/src/systems/construction/plan.cairo`
- Existing system handler: `src/common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionPlanned.js`
- Existing component handlers: `Dispatcher/components/Building.js`, `Location.js`, `Control.js`

The action handler validates, writes components, and returns the correct `returnValues`.
The existing `ConstructionPlanned` Dispatcher handler is then run against the synthetic
event to produce Activity records, Socket.IO messages, and PackedLotData updates:

```js
// src/common/gameLogic/handlers/construction/plan.js
const { Building, Entity, Lot, Permission } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const IdGenerator = require('../../helpers/idGenerator');
const { EntityService, LocationComponentService } = require('@common/services');

class ConstructionPlanHandler extends BaseActionHandler {
  getEventName() { return 'ConstructionPlanned'; }

  async validate() {
    const { lot, building_type, caller_crew } = this.vars;

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: caller_crew.id, label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'], format: true
    });
    if (!this.crew) throw new Error('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Crew must be ready (not busy)
    CrewValidator.assertReady(this.crew);

    // 3. Lot must exist on an asteroid
    this.lot = await EntityService.getEntity({
      id: lot.id, label: Entity.IDS.LOT,
      components: ['Location'], format: true
    });
    if (!this.lot) throw new Error('Lot not found');

    // 4. Lot must not already have a building
    const existing = await EntityService.getEntities({
      label: Entity.IDS.BUILDING,
      match: { 'Location.location.id': lot.id }
    });
    if (existing.length > 0) throw new Error('Lot already has a building');

    // 5. Must have USE_LOT permission on the lot
    await AccessValidator.assertPermission(this.crew, this.lot, Permission.IDS.USE_LOT);

    // 6. Valid building type
    if (!Building.TYPES[building_type]) throw new Error('Invalid building type');
  }

  async applyStateChanges() {
    const { lot, building_type, caller_crew } = this.vars;
    const now = Math.floor(Date.now() / 1000);

    // Generate a new building ID
    this.newBuildingId = await IdGenerator.next(Entity.IDS.BUILDING);

    // Resolve full location chain for the lot
    const lotEntity = EntityLib.toEntity(lot);
    const asteroidEntity = this.lot.Location?.locations?.find(
      l => l.label === Entity.IDS.ASTEROID
    );
    const fullLocation = await LocationComponentService.getFullLocation(lotEntity);

    // Create the new Building entity and all its initial components atomically.
    // This uses mongoose.model('Entity').updateOne({ uuid }, data, { upsert: true })
    // to create the Entity document, then writes each component via
    // ComponentService.updateOrCreateFromEvent(). Wrapped in a MongoDB session
    // so if any component write fails, everything rolls back.
    await this.createEntityWithComponents(
      { id: this.newBuildingId, label: Entity.IDS.BUILDING },
      [
        {
          component: 'Building',
          data: {
            buildingType: Number(building_type),
            status: Building.CONSTRUCTION_STATUSES.PLANNED,
            plannedAt: now,
            finishTime: 0
          }
        },
        {
          component: 'Control',
          data: {
            controller: EntityLib.toEntity(caller_crew)
          }
        },
        {
          component: 'Location',
          data: {
            location: lotEntity,
            locations: fullLocation
          }
        },
        {
          component: 'Name',
          data: { name: '' }
        }
      ]
    );

    return { buildingId: this.newBuildingId };
  }

  // returnValues must match what the chain's ConstructionPlanned event produces.
  // The existing Dispatcher/systems/ConstructionPlanned handler reads these fields
  // from this.eventDoc.returnValues in its processEvent() method.
  getReturnValues() {
    const { lot, building_type, caller_crew } = this.vars;
    const asteroidId = Lot.toPosition(lot.id)?.asteroidId;
    return {
      building: { id: this.newBuildingId, label: Entity.IDS.BUILDING },
      buildingType: Number(building_type),
      asteroid: { id: asteroidId, label: Entity.IDS.ASTEROID },
      lot,
      callerCrew: caller_crew,
      caller: this.address,
      gracePeriodEnd: Math.floor(Date.now() / 1000) + 86400
    };
  }

  // Point to the existing Dispatcher system handler.
  // After applyStateChanges() writes the components, this handler will
  // be instantiated with the synthetic event and run to produce:
  //   - Activity record (via ActivityService.findOrCreateOne)
  //   - Socket.IO messages (crew room + asteroid room)
  //   - PackedLotDataService.update(lotEntity)
  getDispatcherSystemHandler() {
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ConstructionPlanned');
  }
}

module.exports = ConstructionPlanHandler;
```

**What the action handler does vs. what the Dispatcher handler does:**

| Responsibility | Who handles it |
|---------------|----------------|
| Validation (permissions, lot empty, crew ready) | Action handler (`validate()`) |
| Component writes (Building, Control, Location, Name) | Action handler (`applyStateChanges()`) |
| Activity record creation | Dispatcher handler (`processEvent()`) |
| Socket.IO messages (crew room, asteroid room) | Dispatcher handler (`processEvent()` + `emitSocketEvents()`) |
| PackedLotDataService.update | Dispatcher handler (`processEvent()`) |
| ES entity indexing | `writeComponent()` / `createEntityWithComponents()` (automatic) |

This pattern applies to **every** action handler. The only things that vary per handler are:
1. **`validate()`** — what to check
2. **`applyStateChanges()`** — which components to write
3. **`getReturnValues()`** — must match the on-chain event's returnValues structure
4. **`getDispatcherSystemHandler()`** — which existing handler to run

### 6.8 Validator Modules

Each validator mirrors logic from the Cairo contracts:

**`validators/access.js`** — Mirrors `influence-starknet/src/common/access.cairo`:
- `assertControlledBy(entity, address)` — Checks NFT ownership chain (Crew → controller address)
- `assertPermission(crew, target, permissionId)` — Multi-tier permission check:
  1. Public policy on target?
  2. Is crew the controller?
  3. Whitelist agreement?
  4. Prepaid agreement (time-valid)?
  5. Contract policy?

**`validators/crew.js`** — Mirrors `influence-starknet/src/common/crew.cairo`:
- `assertReady(crew)` — `crew.Crew.readyAt <= now`
- `assertFed(crew)` — food consumption calculation based on `crew.Crew.lastFed` and time acceleration
- `assertDelegated(crew, address)` — delegation check

**`validators/inventory.js`** — Mirrors `influence-starknet/src/common/inventory.cairo`:
- `assertCapacity(inventory, product, amount)` — checks mass + volume constraints from `Inventory.TYPES`
- `assertContains(inventory, product, amount)` — checks sufficient quantity
- Actual inventory mutations are done via `writeComponent('Inventory', ...)` in the handler

**`validators/location.js`**:
- `assertSameLocation(entityA, entityB)` — checks entities are on the same lot/asteroid
- `assertOnAsteroid(entity, asteroidId)` — checks entity is on specific asteroid

**`validators/stateMachine.js`**:
- `assertStatus(component, expectedStatus)` — e.g., Extractor must be IDLE to start
- `assertFinished(component)` — e.g., `finishTime <= now` for time-gated completions

### 6.9 ID Generation

On-chain, entity IDs are assigned by the contract. Locally, we need a thread-safe incrementing ID generator.

**`helpers/idGenerator.js`**:
```js
const mongoose = require('mongoose');

const LOCAL_ID_OFFSET = 100_000_000; // avoid colliding with on-chain IDs

class IdGenerator {
  // Uses MongoDB findOneAndUpdate for atomic increment — safe under concurrency
  static async next(entityLabel) {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findOneAndUpdate(
      { entityLabel },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    return LOCAL_ID_OFFSET + counter.seq;
  }
}

module.exports = IdGenerator;
```

This requires a new simple Counter model:

**New file: `src/common/storage/db/models/Counter.js`**
```js
const { Schema, model } = require('mongoose');
const CounterSchema = new Schema({
  entityLabel: { type: Number, required: true, unique: true },
  seq: { type: Number, default: 0 }
});
module.exports = model('Counter', CounterSchema);
```

---

## 7. Phase 5: Client Integration

### 7.1 Client Changes Overview

The client currently submits game actions as Starknet transactions. In hybrid
mode, it needs to POST to the local server instead. The changes are concentrated
in a few files — the read path (entity queries, search, activity feed, Socket.IO)
is completely unchanged.

**Scope:** ~6 files modified, 0 new files. The hardest part is not the hybrid
branch itself (it follows the existing simulation pattern) but disabling all the
Starknet transaction machinery that doesn't apply.

### 7.2 New Client Config

**File: `influence-client/src/appConfig/_default.json`** — Add:
```json
{
  "GameMode": "chain"
}
```

Environment variable override: `REACT_APP_GAME_MODE=hybrid`

**New helper** (or add to an existing utils file):
```js
const appConfig = require('appConfig'); // or however the client imports config
const getGameMode = () => appConfig.get('GameMode') || 'chain';
const isHybrid = () => getGameMode() === 'hybrid';
```

### 7.3 Modify ChainTransactionContext — executeSystem

**File: `influence-client/src/contexts/ChainTransactionContext.js`**

The `executeSystem` callback (line ~1166) already has a simulation branch. Add
a hybrid branch **before** the Starknet flow. The simulation branch is the
template — hybrid mode is similar but POSTs to the server instead of updating
local Zustand state.

```js
const executeSystem = useCallback(async (key, vars, meta = {}) => {
  if (simulationEnabled) {
    // ... existing simulation logic (tutorial mode, lines 1167-1177)
  }

  if (isHybrid()) {
    try {
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await api.post(`/v2/actions/${key}`, {
        callerCrew: crew,
        vars,
        meta
      }, {
        headers: { 'X-Idempotency-Key': idempotencyKey }
      });

      // Dispatch as "pending" then immediately "complete" — the server
      // already committed the state and will emit Socket.IO events.
      const txHash = response.data.event?.transactionHash || `0xlocal_${Date.now()}`;
      dispatchPendingTransaction({ key, vars, meta, txHash });
      dispatchPendingTransactionComplete(txHash);
      return;
    } catch (error) {
      if (error.response?.status === 409) {
        // WriteConflict — auto-retry once
        // (TODO: exponential backoff for repeated conflicts)
        return executeSystem(key, vars, meta);
      }
      onTransactionError(error.response?.data?.error || error.message, key, vars);
      return;
    }
  }

  // ... existing Starknet transaction flow (lines 1180+)
});
```

**Key differences from the simulation branch:**
- POSTs to server (network call) instead of local state mutation
- Sends idempotency key for crash safety
- Handles 409 (WriteConflict) with auto-retry
- Dispatches both `pending` and `complete` — no polling needed

### 7.4 Skip Token Approvals

**File: `influence-client/src/contexts/ChainTransactionContext.js` (lines ~800-811)**

The current flow prepends ERC-20 approval calls before game actions:
```js
// Current code — approve escrow amount
if (totalEscrow > 0n) {
  calls.unshift(System.getApproveErc20Call(totalEscrow, SWAY_ADDRESS, ESCROW_ADDRESS));
}
// approve purchase token
if (totalPrice > 0n) {
  calls.unshift(System.getApproveErc20Call(totalPrice, TOKEN_ADDRESS, DISPATCHER_ADDRESS));
}
```

In hybrid mode, there are no on-chain tokens to approve — the server manages
balances directly. Wrap this block:
```js
if (!isHybrid()) {
  // ... existing approval logic
}
```

### 7.5 Skip Gas Estimation & Paymaster

**File: `influence-client/src/contexts/ChainTransactionContext.js` (lines ~579-627)**

The `executeWithAccount()` function estimates gas fees and selects a paymaster:
```js
const fees = await walletAccount.estimatePaymasterTransactionFee(formattedCalls, { feeMode: { gasToken } });
```

In hybrid mode, `executeWithAccount()` is never called — the hybrid branch in
`executeSystem` returns before reaching it. **No changes needed** to this
function, but verify that no other code path calls it in hybrid mode.

### 7.6 Skip Session Key Setup

**File: `influence-client/src/contexts/SessionContext.js`**

On wallet connect, the client sets up Starknet session keys (line ~42-48):
```js
const allowedMethods = [
  { 'Contract Address': appConfig.get('Starknet.Address.dispatcher'), selector: 'run_system' },
  { 'Contract Address': appConfig.get('Starknet.Address.swayToken'), selector: 'transfer_with_confirmation' },
  // ...
];
```

This drives the session key request to Argent/Braavos on connect. In hybrid
mode the whole session key flow is unnecessary (no gas, no chain transactions).

Guard the session key initialization:
```js
// In the wallet connection flow (lines ~96-200)
if (!isHybrid()) {
  // ... existing session key setup, paymaster init
}
```

The wallet connection itself still happens (needed for JWT auth) — only the
session key and paymaster parts are skipped.

### 7.7 Skip Transaction Polling & Revert Detection

**File: `influence-client/src/contexts/ChainTransactionContext.js`**

Three polling mechanisms need to be skipped in hybrid mode:

**A) `provider.waitForTransaction()` (line ~956):**
```js
// Currently polls every 5s for transaction receipt
provider.waitForTransaction(txHash, { retryInterval: 5000 })
```
Not called in hybrid mode because the hybrid branch dispatches `complete`
immediately. But guard the pending transaction recovery on page load:

```js
// In the effect that recovers pending transactions on mount (~line 941):
if (isHybrid()) return; // No pending chain transactions to recover
```

**B) Event-based confirmation (line ~992):**
```js
const txEvent = getTxEvent(txHash);  // matches txHash against activity list
if (txEvent) {
  contracts[key].onConfirmed(txEvent, vars);
  dispatchPendingTransactionComplete(txHash);
}
```
Not reached in hybrid mode (already dispatched `complete` in executeSystem).
No changes needed.

**C) Revert detection after 30s (lines ~1002-1028):**
```js
provider.getTransactionReceipt(txHash)
  .then((receipt) => {
    if (receipt?.execution_status === 'REVERTED') { ... }
  })
```
Same — not reached for hybrid transactions. No changes needed.

### 7.8 SWAY Balance

**File: `influence-client/src/hooks/useWalletTokenBalance.js`**

The `useSwayBalance` hook (line ~42) reads balance directly from Starknet RPC:
```js
provider.callContract({
  contractAddress: tokenAddress,
  entrypoint: 'balanceOf',
  calldata: [accountAddress]
})
```

In hybrid mode this returns the real on-chain balance, which has nothing to do
with the forked game state. Two options:

**Option A — Server-side SWAY balance (recommended):**

Add a SWAY balance component to the server's ECS. The fork tool imports the
on-chain balance at fork time. Game actions that involve SWAY (buy orders,
agreement payments) debit/credit via component writes.

Client change:
```js
// In useWalletTokenBalance.js
if (isHybrid()) {
  // Read from server API instead of Starknet RPC
  const { data } = useQuery(['swayBalance', accountAddress], () =>
    api.get(`/v2/entities?id=${crewId}&label=1&components=Wallet`).then(r => r.data)
  );
  return data?.Wallet?.swayBalance || 0n;
}
```

Server change: new `WalletComponent` or similar (add to the plan if chosen).

**Option B — Infinite SWAY (simpler, for dev/testing):**

```js
// In useWalletTokenBalance.js
if (isHybrid()) {
  return { data: BigInt('50000000000000000000000000'), isLoading: false }; // 50M SWAY
}
```

This matches the `MockTransactionManager`'s starting balance
(`50e6 * TOKEN_SCALE`). Simpler but means SWAY is meaningless in hybrid mode.

**Decision:** This is Open Question #3 (SWAY token economy). Start with
Option B for the initial implementation, migrate to Option A if SWAY scarcity
matters for gameplay testing.

**Components that display SWAY balance:**
- `src/game/interface/hud/SystemControls.js` (lines 175, 228-230) — top HUD bar
- Various action dialogs: `ShoppingList.js`, `MarketplaceOrder.js`,
  `PurchaseEntity.js`, `FormAgreement.js`

These don't need changes — they consume `useSwayBalance` which handles the
mode branching internally.

### 7.9 Other Direct RPC Calls

Two other places read directly from Starknet RPC:

**A) Random event check**
**File: `influence-client/src/contexts/CrewContext.js` (line ~234)**
```js
provider.callContract(System.getRunSystemCall('CheckForRandomEvent', vars, DISPATCHER_ADDRESS))
```

In hybrid mode, random events don't exist (no on-chain entropy source). Either:
- Return a no-op result (no random event)
- Implement a server-side random event endpoint if needed later

```js
if (isHybrid()) return null; // No random events in hybrid mode
```

**B) Agreement eligibility check**
**File: `influence-client/src/game/interface/hud/actionDialogs/FormAgreement.js` (lines ~240-248)**
```js
provider.callContract({
  contractAddress: policy.contract,
  entrypoint: 'accept',
  calldata: [...]
})
```

This is a `staticCall` (read-only) to check if a policy contract would accept
the caller. In hybrid mode, the server handles policy validation — this check
should either be skipped or routed to a server endpoint.

```js
if (isHybrid()) {
  // Server validates policies during action execution.
  // Optimistically allow all — server returns 400 if invalid.
  return true;
}
```

### 7.10 Error Handling for New HTTP Status Codes

The hybrid `executeSystem` branch returns errors that the chain flow doesn't.
Add user-facing error handling:

```js
// In the hybrid catch block (Section 7.3):
catch (error) {
  const status = error.response?.status;
  const message = error.response?.data?.error;

  if (status === 409) {
    // WriteConflict — auto-retry (already handled above)
  } else if (status === 400) {
    // Validation failure — show to user
    onTransactionError(message || 'Action validation failed', key, vars);
  } else if (status === 500) {
    onTransactionError('Server error — please try again', key, vars);
  } else {
    onTransactionError(message || 'Network error', key, vars);
  }
}
```

### 7.11 World Fork Display

Add a small UI element showing which universe the player is in. Fetch from
`GET /v2/world` on app load:

```js
// New hook: useWorldFork.js
const useWorldFork = () => {
  return useQuery(['worldFork'], () => api.get('/v2/world').then(r => r.data), {
    enabled: isHybrid(),
    staleTime: Infinity  // fork metadata never changes
  });
};
```

Display in the HUD (e.g., next to the SWAY balance in `SystemControls.js`):
```jsx
{isHybrid() && worldFork && (
  <ForkBadge>
    {worldFork.label} · Block {worldFork.forkBlock.toLocaleString()}
  </ForkBadge>
)}
```

### 7.12 What Stays the Same on the Client

- **Entity queries** — unchanged, still hit `/v2/entities`, Elasticsearch
- **Socket.IO** — unchanged, server still emits events via Dispatcher handlers
- **Activity feed** — unchanged, server creates Activity records in sideEffectPhase
- **React Query cache invalidation** — unchanged, driven by Socket.IO events
- **NFT images/metadata** — unchanged
- **Auth flow** — unchanged (wallet connection + JWT). Wallet connect is still
  needed to sign the login challenge, even though no chain transactions happen.
- **Search** — unchanged (Elasticsearch)

### 7.13 Client File Change Summary

| File | Change |
|------|--------|
| `src/appConfig/_default.json` | Add `GameMode` key |
| `src/contexts/ChainTransactionContext.js` | Hybrid branch in `executeSystem` (~line 1166); skip approval prepend (~line 800); guard pending tx recovery on mount |
| `src/contexts/SessionContext.js` | Skip session key + paymaster init in hybrid mode |
| `src/hooks/useWalletTokenBalance.js` | Return mock/server SWAY balance in hybrid mode |
| `src/contexts/CrewContext.js` | Skip `CheckForRandomEvent` RPC call in hybrid mode |
| `src/game/interface/hud/actionDialogs/FormAgreement.js` | Skip policy `accept` RPC call in hybrid mode |
| `src/game/interface/hud/SystemControls.js` | Add world fork badge (optional) |
| `src/hooks/useWorldFork.js` | New hook: fetch fork metadata from `/v2/world` |

---

## 8. Phase 6: Login & Ownership Sync

### 8.1 Authentication — Unchanged

The wallet auth flow stays identical:
1. `GET /v2/auth/login/:address` → challenge
2. User signs with Starknet wallet
3. `POST /v2/auth/login/:address` → JWT

This still verifies the user owns the private key for their Starknet address.

### 8.2 How Ownership Already Works

The existing codebase handles NFT ownership entirely via **Transfer events**, not via
direct contract queries. There is no `getTokensOwnedBy()` or `balanceOf()` call anywhere
in the codebase. Instead:

1. **StarknetProvider** only has: `getEvents()`, `getBlock()`, `getBlockNumber()`
2. **Transfer event handlers** (`Asteroid/Transfer.js`, `Crewmate/Transfer.js`) update
   the `Nft` component's `owners.starknet` field via `ComponentService.updateOrCreateFromEvent()`
3. **NftComponentService** queries the DB: `findByOwner(address, label)` uses
   `$or: [{ 'owners.ethereum': address }, { 'owners.starknet': address }]`

In hybrid mode, the Starknet event retriever already runs for asteroid + crewmate
contracts (Section 4.2). Transfer events are fetched, stored, and processed by the
existing handlers. **No new ownership sync code is needed for ongoing updates.**

### 8.3 World Fork Tool

A hybrid server's game state is a **fork** of the on-chain world at a specific
Starknet block. The fork tool is a one-time CLI that snapshots the chain state
into the local MongoDB and records the fork point — block number, block hash,
and timestamp — so it can be queried by the API and displayed in the game client.

**Usage:**
```bash
# Fork from the current chain head
node src/workers/forkWorld.js

# Fork from a specific block
node src/workers/forkWorld.js --block 850000

# Fork with a custom label
node src/workers/forkWorld.js --label "dev-test-universe"
```

**What it does (in order):**
1. Resolves the target block (defaults to latest via `StarknetProvider.getBlockNumber()`)
2. Retrieves the block metadata (hash, timestamp) via `StarknetProvider.getBlock()`
3. Runs the event retriever catch-up from block 0 to the target block
4. Runs the event processor to apply all retrieved events
5. Writes a `WorldFork` document to MongoDB recording the fork point
6. Logs a summary and exits

**New file: `src/workers/forkWorld.js`**

```js
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
  .help()
  .parse();

const main = async function ({ block, label }) {
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

  // 1. Resolve target block
  const provider = new StarknetProvider();
  const targetBlockNumber = block || await provider.getBlockNumber();
  const targetBlock = await provider.getBlock(targetBlockNumber);

  logger.info(`Forking world from Starknet block ${targetBlockNumber} (hash: ${targetBlock.blockHash})`);

  // 2. Retrieve all events from genesis to target block
  const retriever = new StarknetRetriever();
  await retriever.runOnce({ fromBlock: 0, toBlock: targetBlockNumber });

  // 3. Process all retrieved events
  const processor = new EventProcessor({ runDelay: 0 });
  await processor.main({ timestamp: 0 });

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
  const asteroidCount = await NftComponent.countDocuments({ 'entity.label': 1 }); // Entity.IDS.ASTEROID
  const crewmateCount = await NftComponent.countDocuments({ 'entity.label': 2 }); // Entity.IDS.CREWMATE

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
```

**New file: `src/common/storage/db/models/WorldFork.js`**

```js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  blockNumber: { type: Number, required: true },
  blockHash: { type: String, required: true },
  blockTimestamp: { type: Date, required: true },  // on-chain block time
  forkedAt: { type: Date, required: true },         // when the fork was created
  label: { type: String, default: null }
}, { timestamps: true });

// Only one fork per database
schema.index({}, { unique: true });

module.exports = mongoose.model('WorldFork', schema);
```

**Startup check** — Replace the bootstrap.js helper. On server startup in hybrid
mode, check for the WorldFork document:

```js
// In server startup (hybrid mode only)
const WorldFork = mongoose.model('WorldFork');
const fork = await WorldFork.findOne({});
if (!fork) {
  logger.error(
    'No world fork found. Run the fork tool first:\n'
    + '  node src/workers/forkWorld.js'
  );
  process.exit(1);
}
logger.info(`Hybrid mode: world forked from block ${fork.blockNumber} (${fork.label})`);
```

**API endpoint** — Expose the fork info so the client can display it:

```js
// In the actions controller (or a new world controller), hybrid mode only
router.get('/v2/world', async (ctx) => {
  const fork = await mongoose.model('WorldFork').findOne({}).lean();
  if (!fork) {
    ctx.status = 404;
    ctx.body = { error: 'No world fork found' };
    return;
  }
  ctx.status = 200;
  ctx.body = {
    forkBlock: fork.blockNumber,
    forkBlockHash: fork.blockHash,
    forkBlockTimestamp: fork.blockTimestamp,
    forkedAt: fork.forkedAt,
    label: fork.label
  };
});
```

This answers **Open Question #1** (initial world state) — the fork tool snapshots
whatever exists on-chain at the target block. It also addresses **Open Question #4**
(multi-server state) — each server is its own "universe" identified by its fork point.

### 8.4 Per-Login Ownership Check

Once the retriever has populated ownership data, no per-login chain query is needed.
The user's NFTs are already in MongoDB. The existing API endpoints (e.g.,
`EntityService.getEntities({ match: { 'Nft.owners.starknet': address } })`) return
the user's asteroids and crewmates from the DB.

If a login needs to confirm ownership is fresh (e.g., the user just traded an NFT
seconds ago), the retriever's polling interval determines the lag. For tighter
freshness guarantees, the login flow can trigger a one-shot retriever run for
recent blocks:

```js
// Optional: in auth controller, trigger a quick catch-up for recent blocks
if (isHybrid()) {
  const retriever = new StarknetRetriever();
  // Fetch last ~100 blocks to catch very recent transfers
  const currentBlock = await provider.getBlockNumber();
  retriever.runOnce({ fromBlock: currentBlock - 100, toBlock: currentBlock })
    .catch(err => logger.warn('Login ownership refresh failed:', err));
}
```

This uses the existing `StarknetRetriever.runOnce()` — no new code needed.

### 8.5 Background Ownership Updates

The Starknet event retriever (running in its normal loop, filtered to asteroid +
crewmate contracts per Section 4.2) handles ongoing ownership changes:
- Transfer events (marketplace trades) update the Nft component
- Bridge events update ownership across chains

This keeps MongoDB in sync with on-chain ownership automatically.

---

## 9. Phase 7: Time & Tick System

### 9.1 The Problem

Many game actions are time-gated: construction takes X hours, extraction takes Y hours, transit takes Z hours. On-chain, the player submits a "Finish" transaction after the time elapses, and the contract validates `block.timestamp >= finish_time`.

In hybrid mode, there's no block progression. Two options:

### 9.2 Option A: Player-Triggered Completion (Recommended)

Keep the same pattern — the client calls `POST /v2/actions/ConstructionFinish` when the timer expires. The server validates `Date.now() >= finishTime`. The client already shows countdown timers and enables the "Finish" button when time is up.

**Pros:** Mirrors on-chain behavior exactly, no new infrastructure
**Cons:** None significant — the client already handles this UX

### 9.3 Option B: Server-Side Auto-Completion (Optional Enhancement)

A background worker that periodically checks for entities with `finishTime <= now` and auto-completes them.

**New file: `src/workers/gameTickProcessor.js`**
```js
// Runs in hybrid mode only
// Polls for entities with expired timers and auto-completes actions
// e.g., Building with status UNDER_CONSTRUCTION and finishTime <= now → set to OPERATIONAL
```

This is optional and can be added later. Option A works immediately.

### 9.4 Time Acceleration

The game uses a time acceleration factor (e.g., 24x) stored as a game constant. The `@influenceth/sdk` `Time` module handles conversion:

```js
const { Time } = require('@influenceth/sdk');
const gameDuration = Time.toGameDuration(realSeconds, timeAcceleration);
const realDuration = Time.toRealDuration(gameSeconds, timeAcceleration);
```

The hybrid server should read/write the `TIME_ACCELERATION` constant from the `Constant` MongoDB model (same as chain mode uses). Default is already configured.

---

## 10. Phase 8: Testing & Verification

### 10.1 Health Check Endpoint

There is no health endpoint in the current codebase. Add one so that every phase
can be verified with a single curl. This is also needed by Docker health checks
and load balancers in production.

**New file: `src/api/controllers/health.js`**

```js
const KoaRouter = require('@koa/router');
const mongoose = require('mongoose');
const appConfig = require('config');
const { getMode, isHybrid } = require('@common/lib/gameMode');

const router = new KoaRouter();

router.get('/v2/health', async (ctx) => {
  const checks = {};

  // MongoDB
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  checks.mongodb = {
    status: mongoose.connection.readyState === 1 ? 'ok' : 'error',
    readyState: mongoose.connection.readyState
  };

  // Redis (optional)
  try {
    const redis = require('@common/lib/cache').client; // adjust to actual redis client export
    if (redis?.isOpen) {
      checks.redis = { status: 'ok' };
    } else {
      checks.redis = { status: 'not_connected' };
    }
  } catch (e) {
    checks.redis = { status: 'not_configured' };
  }

  // Elasticsearch (optional)
  try {
    const esUri = appConfig.get('Elasticsearch.uri');
    checks.elasticsearch = { status: esUri ? 'configured' : 'not_configured' };
  } catch (e) {
    checks.elasticsearch = { status: 'not_configured' };
  }

  // Game mode
  checks.gameMode = {
    mode: getMode(),
    hybrid: isHybrid()
  };

  // World fork (hybrid only)
  if (isHybrid()) {
    try {
      const fork = await mongoose.model('WorldFork').findOne({}).lean();
      checks.worldFork = fork
        ? { status: 'ok', block: fork.blockNumber, label: fork.label, forkedAt: fork.forkedAt }
        : { status: 'missing' };
    } catch (e) {
      checks.worldFork = { status: 'error', error: e.message };
    }
  }

  const allOk = checks.mongodb.status === 'ok'
    && (!isHybrid() || checks.worldFork?.status === 'ok');

  ctx.status = allOk ? 200 : 503;
  ctx.body = { status: allOk ? 'ok' : 'degraded', checks };
});

module.exports = router;
```

Add to `src/api/controllers/index.js` (always mounted — useful in both modes).

### 10.2 Per-Phase Verification

Each phase has concrete checks you can run immediately after completing it.
This is not an afterthought — **build the verification step before building the phase.**

#### After Phase 1: Configuration

```bash
# Verify gameMode helper resolves correctly
GAME_MODE=hybrid node -e "
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  const { getMode, isHybrid } = require('@common/lib/gameMode');
  console.log('mode:', getMode(), 'isHybrid:', isHybrid());
"
# → mode: hybrid isHybrid: true

# Verify config loads the new section
GAME_MODE=hybrid node -e "
  require('dotenv').config({ silent: true });
  const config = require('config');
  console.log('GameMode config:', JSON.stringify(config.get('GameMode')));
"
# → GameMode config: {"mode":"hybrid","chainSyncContracts":["asteroid","crewmate"]}

# Verify MongoDB replica set supports transactions
node -e "
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  require('@common/storage/db');
  const mongoose = require('mongoose');
  setTimeout(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    await session.abortTransaction();
    session.endSession();
    console.log('Transactions OK');
    process.exit(0);
  }, 2000);
"
# → Transactions OK (or "Transaction numbers are only allowed..." if replica set is missing)
```

#### After Phase 2: Selective Event Pipeline

```bash
# Start the server and workers in hybrid mode, then check:
GAME_MODE=hybrid node src/workers/eventRetriever.js --eventSource ethereum
# → "Ethereum retriever disabled in hybrid mode" + exit

GAME_MODE=hybrid node src/workers/starknetEventAuditor.js
# → "Starknet event auditor disabled in hybrid mode" + exit

# Starknet retriever should start normally (filtered to asteroid + crewmate)
GAME_MODE=hybrid node src/workers/eventRetriever.js --eventSource starknet
# → Starts polling (Ctrl+C to stop)
```

#### After Phase 3: Action API Endpoints

```bash
# Start the API server
GAME_MODE=hybrid npm run watch &

# Health check
curl http://localhost:3001/v2/health
# → { "status": "ok", "checks": { "mongodb": { "status": "ok" }, "gameMode": { "mode": "hybrid" }, ... } }

# Unknown action should return 400
curl -X POST http://localhost:3001/v2/actions/NonExistentAction \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"callerCrew": {"id": 1, "label": 1}, "vars": {}}'
# → { "error": "Unknown action: NonExistentAction" }

# Without auth should return 401
curl -X POST http://localhost:3001/v2/actions/ConstructionPlan \
  -H "Content-Type: application/json" \
  -d '{"callerCrew": {"id": 1, "label": 1}, "vars": {}}'
# → 401
```

#### After Phase 4: First Handler (e.g., ConstructionPlan)

This is where you need real entity data. Either fork the world first (Phase 6)
or seed test data manually:

```bash
# Option A: Fork the world (runs the full retriever catch-up)
node src/workers/forkWorld.js --label "dev-test"

# Option B: Seed minimal test entities directly
node -e "
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  require('@common/storage/db');
  const mongoose = require('mongoose');
  const Entity = require('@common/lib/Entity');
  setTimeout(async () => {
    // Create a test asteroid
    const asteroid = Entity.Asteroid(1);
    await mongoose.model('Entity').updateOne(
      { uuid: asteroid.uuid }, asteroid, { upsert: true }
    );
    // Create a test crew owned by a test address
    const crew = Entity.Crew(1);
    await mongoose.model('Entity').updateOne(
      { uuid: crew.uuid }, crew, { upsert: true }
    );
    await mongoose.model('NftComponent').create({
      entity: crew, owners: { starknet: '0xYOUR_TEST_ADDRESS' }
    });
    await mongoose.model('CrewComponent').create({
      entity: crew, status: 1 /* ready */
    });
    console.log('Test entities seeded');
    process.exit(0);
  }, 2000);
"
```

Then test the action:

```bash
curl -X POST http://localhost:3001/v2/actions/ConstructionPlan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "callerCrew": { "id": 1, "label": 1 },
    "vars": { "asteroidId": 1, "lotIndex": 42, "buildingType": 1 }
  }'
# Success → 200 with result
# Validation failure → 400 with error message
# Check that the Building entity was created:
curl "http://localhost:3001/v2/entities?id=NEW_BUILDING_ID&label=5&components=Building,Location"
```

#### After Phase 5: Client Integration

```bash
# Start the client pointed at the local server
cd /path/to/influence-client
REACT_APP_API_URL=http://localhost:3001 REACT_APP_GAME_MODE=hybrid npm start

# Manual test checklist:
# □ Connect wallet
# □ See your asteroids and crewmates (from the fork)
# □ Plan a construction → verify building appears on the lot
# □ Check the Activity feed updates via Socket.IO
# □ Refresh the page — verify state persisted in MongoDB
```

#### After Phase 6: World Fork

```bash
# Run the fork
node src/workers/forkWorld.js --label "test-fork"

# Verify fork metadata
curl http://localhost:3001/v2/world
# → { "forkBlock": 850000, "label": "test-fork", ... }

# Verify entity data was populated
curl http://localhost:3001/v2/health
# → worldFork.status: "ok"

# Spot-check: count asteroids
node -e "
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  require('@common/storage/db');
  const mongoose = require('mongoose');
  setTimeout(async () => {
    const count = await mongoose.model('NftComponent').countDocuments({ 'entity.label': 1 });
    console.log('Asteroids:', count);
    process.exit(0);
  }, 2000);
"
```

### 10.3 Smoke Test Script

A single script that exercises the full hybrid flow end-to-end. Run it after
any change to verify nothing is broken.

**New file: `test/smoke/hybrid.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local name="$1" cmd="$2" expected="$3"
  result=$(eval "$cmd" 2>/dev/null || echo "CURL_FAILED")
  if echo "$result" | grep -q "$expected"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (expected '$expected', got: $result)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Hybrid server smoke test: $BASE_URL"
echo ""

echo "Infrastructure:"
check "Health endpoint reachable" \
  "curl -s $BASE_URL/v2/health" '"status"'
check "MongoDB connected" \
  "curl -s $BASE_URL/v2/health | node -e \"process.stdin.on('data',d=>{console.log(JSON.parse(d).checks.mongodb.status)})\"" \
  "ok"
check "Game mode is hybrid" \
  "curl -s $BASE_URL/v2/health | node -e \"process.stdin.on('data',d=>{console.log(JSON.parse(d).checks.gameMode.mode)})\"" \
  "hybrid"
check "World fork exists" \
  "curl -s $BASE_URL/v2/world" '"forkBlock"'

echo ""
echo "API:"
check "Actions endpoint exists (401 without auth)" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $BASE_URL/v2/actions/ConstructionPlan" \
  "401"
check "Unknown action returns error" \
  "curl -s -X POST $BASE_URL/v2/actions/FakeAction -H 'Content-Type: application/json' -H 'Authorization: Bearer test'" \
  "error"

echo ""
echo "Data:"
check "Entities endpoint returns results" \
  "curl -s '$BASE_URL/v2/entities?label=1&limit=1'" \
  "id"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

```bash
# Usage:
chmod +x test/smoke/hybrid.sh
./test/smoke/hybrid.sh                          # default: localhost:3001
./test/smoke/hybrid.sh http://my-server:3001    # remote server
```

### 10.4 Unit Tests

The existing test suite uses `mongodb-memory-server` (with replica set support)
and Mocha/Chai/Sinon. The fixture setup in `test/setup/fixtures.js` spins up an
in-memory MongoDB, creates test credentials, and exposes `this.GLOBALS` and
`this.utils` to all tests.

**Important:** `mongodb-memory-server` defaults to a standalone instance, which
does **not** support transactions. The test setup needs to create a replica set:

```js
// In test/setup/fixtures.js — change MongoMemoryServer to MongoMemoryReplSet:
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// In beforeAll:
mongoServer = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  binary: { version: '6.0.14' }
});
```

This is required for any test that exercises `GameEngine.execute()` (which uses
transactions). Existing tests that don't use transactions are unaffected.

**New test files:**

```
test/src/common/gameLogic/
├── GameEngine.spec.js              # Two-phase execution, idempotency, error codes
├── helpers/
│   ├── syntheticEvent.spec.js      # Event creation, ordering, keys, idempotency lookup
│   └── idGenerator.spec.js         # Counter model, ID uniqueness
├── validators/
│   ├── access.spec.js              # Crew ownership, caller permission
│   ├── crew.spec.js                # Crew ready state, busy check
│   ├── inventory.spec.js           # Resource sufficiency, capacity
│   └── location.spec.js            # Lot occupancy, asteroid presence
├── handlers/
│   ├── construction/
│   │   ├── plan.spec.js
│   │   ├── start.spec.js
│   │   └── finish.spec.js
│   ├── production/
│   │   ├── extractStart.spec.js
│   │   └── extractFinish.spec.js
│   └── ... (one per handler)
test/src/api/controllers/
│   ├── actions.spec.js             # API-level: auth, routing, error codes, idempotency
│   └── health.spec.js              # Health endpoint responses
```

**Test pattern for each handler** (follows existing ConstructionPlanned.spec.js style):

```js
describe('ConstructionPlan Action Handler', function () {
  let jwt;

  beforeEach(async function () {
    // Seed: asteroid, crew with ownership, empty lot
    // (use existing test factories + direct model creates)
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'Entity', 'BuildingComponent', 'LocationComponent',
      'ControlComponent', 'Activity', 'Starknet'
    ]);
  });

  describe('validate()', function () {
    it('should reject if caller does not own the crew', async function () { ... });
    it('should reject if crew is busy (not ready)', async function () { ... });
    it('should reject if lot is occupied', async function () { ... });
    it('should reject invalid building type', async function () { ... });
  });

  describe('full execution via GameEngine.execute()', function () {
    it('should create Building entity with correct components', async function () {
      const result = await GameEngine.execute({
        action: 'ConstructionPlan',
        address: TEST_ADDRESS,
        callerCrew: { id: 1, label: 1 },
        vars: { asteroidId: 1, lotIndex: 42, buildingType: 1 }
      });
      // Assert Building entity exists
      const building = await mongoose.model('BuildingComponent').findOne({});
      expect(building).to.exist;
      expect(building.buildingType).to.equal(1);
    });

    it('should create a synthetic Starknet event', async function () { ... });
    it('should create an Activity record (via Dispatcher handler)', async function () { ... });
    it('should queue entity for ES indexing', async function () { ... });
    it('should return idempotent result on retry with same key', async function () {
      const key = 'test-idempotency-key';
      const r1 = await GameEngine.execute({ ..., idempotencyKey: key });
      const r2 = await GameEngine.execute({ ..., idempotencyKey: key });
      expect(r2.replayed).to.be.true;
    });
  });

  describe('TOCTOU protection', function () {
    it('should throw WriteConflict on concurrent modification', async function () {
      // Start two executions for the same lot in parallel
      // One should succeed, one should throw WriteConflict (error code 112)
    });
  });

  describe('getReturnValues() vs transformEventData() parity', function () {
    it('should produce the same structure as the Dispatcher handler', function () {
      // Compare handler.getReturnValues() against
      // DispatcherHandler.transformEventData(syntheticEvent)
    });
  });
});
```

### 10.5 Integration Tests

API-level tests using `supertest` (already a devDependency). These test the
full request cycle: HTTP request → auth → controller → GameEngine → DB → response.

```js
// test/src/api/controllers/actions.spec.js
describe('POST /v2/actions/:action', function () {
  it('should return 401 without auth token', async function () { ... });
  it('should return 400 for unknown action', async function () { ... });
  it('should return 400 for validation failure', async function () { ... });
  it('should return 200 for valid action', async function () { ... });
  it('should return 409 on WriteConflict', async function () { ... });
  it('should return same result with idempotency key on retry', async function () { ... });
});

describe('GET /v2/health', function () {
  it('should return 200 with all checks', async function () { ... });
  it('should return 503 if mongodb is down', async function () { ... });
});

describe('GET /v2/world', function () {
  it('should return fork metadata', async function () { ... });
  it('should return 404 if no fork exists', async function () { ... });
});
```

### 10.6 Recommended Implementation Order

Build verification alongside each phase, not after:

```
Phase 1 → immediately run the Phase 1 verification commands above
Phase 2 → verify workers start/exit correctly
Phase 3 → add health controller + actions controller
       → run smoke test (infrastructure checks pass, actions return 401/400)
Phase 4 → for EACH handler:
       1. Write the handler
       2. Write its unit test
       3. Run the test: npm test -- --grep "ConstructionPlan"
       4. Manual curl test against the running server
       → run smoke test after each batch
Phase 5 → manual client testing (see checklist above)
Phase 6 → fork a world, run full smoke test, connect client to forked data
```

The smoke test script should pass after Phase 3 (with some checks skipped) and
fully pass after Phase 6. Run it as a gate before marking any phase complete.

---

## 11. File Change Map

### New Files

| File | Purpose |
|------|---------|
| `src/common/lib/gameMode.js` | Mode detection helper |
| `src/common/gameLogic/GameEngine.js` | Action router |
| `src/common/gameLogic/helpers/syntheticEvent.js` | Creates real Event documents for the write path |
| `src/common/gameLogic/handlers/BaseActionHandler.js` | Base handler class (uses writeComponent → ComponentService.updateOrCreateFromEvent) |
| `src/common/gameLogic/handlers/construction/*.js` | Construction action handlers |
| `src/common/gameLogic/handlers/production/*.js` | Production action handlers |
| `src/common/gameLogic/handlers/crew/*.js` | Crew action handlers |
| `src/common/gameLogic/handlers/deposits/*.js` | Deposit action handlers |
| `src/common/gameLogic/handlers/orders/*.js` | Order action handlers |
| `src/common/gameLogic/handlers/ship/*.js` | Ship action handlers |
| `src/common/gameLogic/handlers/deliveries/*.js` | Delivery action handlers |
| `src/common/gameLogic/handlers/agreements/*.js` | Agreement action handlers |
| `src/common/gameLogic/handlers/policies/*.js` | Policy action handlers |
| `src/common/gameLogic/handlers/misc/*.js` | Misc action handlers |
| `src/common/gameLogic/validators/access.js` | Permission validation |
| `src/common/gameLogic/validators/crew.js` | Crew state validation |
| `src/common/gameLogic/validators/inventory.js` | Inventory validation |
| `src/common/gameLogic/validators/location.js` | Location validation |
| `src/common/gameLogic/validators/stateMachine.js` | State transition validation |
| `src/common/gameLogic/helpers/idGenerator.js` | Entity ID generation |
| `src/common/gameLogic/helpers/timeAcceleration.js` | Time calculation |
| `src/common/gameLogic/helpers/modifiers.js` | Crew/building modifiers |
| `src/common/storage/db/models/WorldFork.js` | Fork point metadata (block number, hash, timestamp, label) |
| `src/workers/forkWorld.js` | CLI tool to snapshot on-chain state and record fork point |
| `src/common/storage/db/models/Counter.js` | ID counter model |
| `src/api/controllers/actions.js` | Action API endpoints |
| `Dockerfile` | Container image for the influence-server |
| `docker-entrypoint.sh` | Entrypoint: waits for mongo, inits replica set, forks world if needed, starts pm2 |
| `docker-compose.yml` | Full stack: server + MongoDB (replica set) + Redis + Elasticsearch |
| `src/api/controllers/health.js` | Health check endpoint (`GET /v2/health`) |
| `test/smoke/hybrid.sh` | End-to-end smoke test script |
| `test/src/common/gameLogic/**/*.spec.js` | Unit tests for game logic engine |
| `test/src/api/controllers/actions.spec.js` | Integration tests for action API |
| `test/src/api/controllers/health.spec.js` | Integration tests for health endpoint |

### Modified Files

| File | Change |
|------|--------|
| `config/default.json` | Add `GameMode` section |
| `config/custom-environment-variables.json` | Map `GAME_MODE` env var |
| `src/api/server.js` | Raise rate limit in hybrid mode (50 → 200 per 10s) |
| `src/api/controllers/index.js` | Export actions controller |
| `src/common/services/Components/Component.js` | Add optional `session` param to `updateOrCreateFromEvent()` / `createOnlyFromEvent()` — pass to `.findOne()` and `.save()` so reads/writes participate in the action's transaction |
| `src/common/storage/db/models/Events/Starknet.js` | Add optional `idempotencyKey` field (String, sparse unique index) for crash-safe action retries |
| `src/common/lib/events/processor/EventProcessor.js` | Filter events in hybrid mode |
| `src/workers/eventRetriever.js` | Disable Ethereum retriever in hybrid mode |
| `src/workers/starknetEventAuditor.js` | Disable in hybrid mode |
| `src/common/storage/db/models/index.js` | Register Counter and WorldFork models |
| `src/api/controllers/index.js` | Export health controller (in addition to actions) |
| `test/setup/fixtures.js` | Switch `MongoMemoryServer` to `MongoMemoryReplSet` for transaction support |

### Client Changes (influence-client)

| File | Change |
|------|--------|
| `src/appConfig/_default.json` | Add `GameMode` config key |
| `src/contexts/ChainTransactionContext.js` | Hybrid branch in `executeSystem` (~line 1166); skip approval prepend (~line 800); guard pending tx recovery on mount |
| `src/contexts/SessionContext.js` | Skip session key + paymaster init when `isHybrid()` |
| `src/hooks/useWalletTokenBalance.js` | Return mock/server SWAY balance in hybrid mode |
| `src/contexts/CrewContext.js` | Skip `CheckForRandomEvent` RPC call in hybrid mode |
| `src/game/interface/hud/actionDialogs/FormAgreement.js` | Skip policy `accept` RPC call in hybrid mode |
| `src/game/interface/hud/SystemControls.js` | Add world fork badge (optional) |
| `src/hooks/useWorldFork.js` | **New file:** fetch fork metadata from `GET /v2/world` |

---

## 12. Implementation Order & Dependencies

```
Phase 1: Configuration (1-2 days)
  ├── Verify MongoDB replica set in all environments (see Prerequisites section)
  ├── gameMode.js helper
  ├── config/default.json + custom-environment-variables.json
  ├── Pin @influenceth/sdk to same version in server + client (prerequisite for all game logic)
  └── No dependencies

Phase 2: Selective Event Pipeline (1-2 days)
  ├── EventProcessor filtering
  ├── Worker early-exit guards
  └── Depends on: Phase 1

Phase 3: Action API Endpoints (1 day)
  ├── actions controller + route mounting
  └── Depends on: Phase 1

Phase 4: Game Logic Engine — Core (2-3 weeks)
  ├── Week 1: BaseActionHandler, validators, ID generation, Counter model
  ├── Week 1: Priority 1 handlers (construction, extraction, processing, sampling, crew station)
  ├── Week 2: Priority 2 handlers (orders/trading)
  ├── Week 2: Priority 3 handlers (ships/transit)
  ├── Week 3: Priority 4-5 handlers (crew mgmt, agreements, policies, misc)
  └── Depends on: Phase 3

Phase 5: Client Integration (2-3 days)
  ├── Client gameMode config + isHybrid() helper
  ├── ChainTransactionContext: hybrid branch in executeSystem, skip approvals
  ├── SessionContext: skip session key + paymaster init
  ├── useWalletTokenBalance: mock SWAY balance (Option B initially)
  ├── CrewContext + FormAgreement: skip direct RPC calls
  ├── World fork badge in HUD (optional)
  └── Depends on: Phase 3 (can start in parallel with Phase 4)

Phase 6: Login & Ownership Sync (2-3 days)
  ├── forkWorld.js CLI tool (retrieves chain state, records fork point)
  ├── WorldFork model + startup check (exit if no fork)
  ├── GET /v2/world endpoint (exposes fork info to client)
  └── Depends on: Phase 1, Phase 2

Phase 7: Time System (1 day)
  ├── Player-triggered completion (Option A) — mostly free, just server-side timestamp check
  └── Depends on: Phase 4

Phase 8: Testing & Verification (ongoing, parallel with all phases)
  ├── Phase 1: run verification commands (gameMode, config, transactions)
  ├── Phase 3: add health controller + smoke test script
  ├── Phase 3: update test fixtures (MongoMemoryReplSet for transactions)
  ├── Phase 4: write unit test for EACH handler alongside the handler itself
  ├── Phase 4: run smoke test after each handler batch
  ├── Phase 5: manual client testing (checklist in Section 10.2)
  ├── Phase 6: fork world + full smoke test + integration tests
  └── Gate: smoke test must pass before marking any phase complete
```

**Total estimated scope:** ~4-5 weeks for a fully functional hybrid mode with all game actions.

**Minimum viable slice:** Phases 1-3 + Priority 1 handlers from Phase 4 + Phase 5 = ~1.5-2 weeks for a playable core loop (lease lots, build, mine, refine).

---

## 13. Risks & Open Questions

### Risks

1. **Game logic fidelity** — The Starknet contracts contain nuanced validation logic (modifier calculations, crew efficiency formulas, orbital mechanics for transit). Getting this exactly right requires careful reading of the Cairo code in `influence-starknet/src/systems/`. The `@influenceth/sdk` handles much of the math, but edge cases may diverge.

2. **Write path coupling to Event documents** — `ComponentService.updateOrCreateFromEvent()` is the only write method and it requires a real Event Mongoose document with `_id`, `timestamp`, `blockNumber`, `transactionIndex`, `logIndex`, and `__t` discriminator. It also does ordering comparisons (blockNumber > transactionIndex > logIndex) to reject stale events. The plan addresses this with `SyntheticEvent` (Section 6.2) which mints real Starknet Event documents in MongoDB with high-offset block numbers to avoid collisions. Similarly, `ActivityService.findOrCreateOne()` requires `event instanceof mongoose.model('Event')` — the synthetic event satisfies this. If the Event schema or ordering logic changes upstream, the synthetic event factory must be updated to match.

3. **Entity creation is direct, not via a service** — `EntityService` is read-only (aggregation queries). There is no `createEntity()` or `upsert()` method on it. In the on-chain flow, Entity records are created as a side effect of the `entitiesPlugin` (`src/common/storage/db/plugins/entities.js`), which runs `preSave` hooks on component schemas that upsert into the Entity collection. For hybrid mode, we don't rely on this side effect. Instead, `BaseActionHandler.createEntityWithComponents()` explicitly creates the Entity via `mongoose.model('Entity').updateOne({ uuid }, data, { upsert: true })` and then writes all initial components, wrapped in a MongoDB session for atomicity. For updates to existing entities, `writeComponent()` still uses `ComponentService.updateOrCreateFromEvent()` (where the entitiesPlugin acts as a secondary safety net).

4. **EntityService.getEntities implicit upsert** — `getEntities()` (Entity.js lines 59-61) does `Entity.updateOne({ uuid }, data, { upsert: true })` on **every query** when called with `id`/`label` or `uuid`. This is a write side effect on a read method, and it runs without a session. In the two-phase flow this is benign: Phase 1's `createEntityWithComponents()` already committed the entity, so the Phase 2 upsert is a no-op. For pre-existing entities (callerCrew, asteroids) it's also a no-op. However, be aware that any Dispatcher handler call to `EntityService.getEntity()` with an entity reference that doesn't exist yet will silently create a bare Entity document outside any transaction.

5. **EntityService.getEntities match constraints** — The `match` parameter starts the aggregation pipeline at the matched component's collection (e.g., `Component_Location`), not the Entity collection. It only supports matching on one component at a time (multiple dot-keys must share the same component prefix). The `label` parameter is injected as `entity.label` into the match query on that component collection. This works for lookups like "find buildings at this lot" but does not support cross-component filtering in a single query.

6. **Multiplayer consistency (TOCTOU)** — The `validate()` → `applyStateChanges()` gap is a TOCTOU race condition. Example: two players both check that a lot is empty, then both write a building. **Mitigation:** Phase 1 of `GameEngine.execute()` wraps validation + component writes in a MongoDB transaction (Section 6.5). Concurrent modifications to the same documents cause a `WriteConflict` on commit. The action controller should catch `WriteConflict` and return HTTP 409. **Prerequisite:** MongoDB must run as a replica set (even single-node) for transactions to work. **Note:** `ComponentService.updateOrCreateFromEvent()` needs a small modification to accept a `session` parameter for its `.findOne()` and `.save()` calls.

7. **Two-phase commit and Dispatcher handler isolation** — The existing Dispatcher handlers (EntityService, LocationComponentService, etc.) use aggregation pipelines and DB reads with no session parameter. Under MongoDB snapshot isolation, session-less reads cannot see uncommitted writes. This means Dispatcher handlers **cannot run inside the same transaction** as component writes — they'd fail to find the data just written. **Mitigation:** GameEngine uses a two-phase commit (Section 6.5). Phase 1 validates + writes components in a transaction, commits. Phase 2 runs the Dispatcher handler against committed data (no transaction needed). This matches the real pipeline: the retriever commits events first, then the processor runs handlers. **Risk:** If Phase 2 fails, component data is committed but side effects (Activity, notifications, PackedLotData) are missing. This is recoverable — the synthetic event exists in MongoDB and the Dispatcher handler can be re-run against it, same as the EventProcessor retries failed events.

8. **Side-effect parity** — Each handler's `getReturnValues()` must produce the exact same structure as the corresponding Dispatcher handler's `transformEventData()`. If these diverge, the Dispatcher handler will read wrong fields and produce incorrect Activity records, Socket.IO messages, etc. Validate by comparing `getReturnValues()` output against `transformEventData()` for each handler during development.

9. **SDK version alignment** — The server uses `@influenceth/sdk@2.2.0-beta.1` and the client uses `@influenceth/sdk@^2.3.8`. Mismatched versions cause subtle divergences in game constant lookups, time calculations, and entity ID packing. **Mitigation:** Phase 1 prerequisite — pin both to the same version before any game logic is written. Added to Phase 1 task list in Section 12.

### Open Questions

1. ~~**Initial world state**~~ — **Answered by Section 8.3 (World Fork Tool).** The `forkWorld.js` CLI snapshots the on-chain state at a target block into MongoDB. Whatever entities exist on-chain at that block are the initial world state.

2. **Crew creation** — On-chain, crews are NFTs that must be minted. In hybrid mode, should crew creation be free and local? Or tied to the on-chain Crewmate NFTs the user owns?

3. **SWAY token economy** — Should the local server simulate SWAY balances? The client's `MockTransactionManager` gives users a starting balance (`50e6 * TOKEN_SCALE`). The hybrid server would need a similar mechanism.

4. ~~**Multi-server state**~~ — **Answered by Section 8.3 (World Fork Tool).** Each server is its own "universe" identified by its fork point (block number + label). The `GET /v2/world` endpoint exposes this so the client can display which universe the player is in.

5. **Read-only chain data** — Some data the client reads directly from Starknet RPC (e.g., SWAY balance via `useWalletTokenBalance`). In hybrid mode, should the client read these from the local server instead?

6. **Session keys** — The client uses Starknet session keys for gas-free transactions. In hybrid mode, these aren't needed (no gas). The client should skip session key setup.
