# Implementation Plan: Hybrid Local Game Mode

## Goal

Add a `GAME_MODE=hybrid` option to the influence-server that:

1. **Keeps on-chain:** Starknet wallet authentication + Asteroid and Crewmate NFT ownership tracking
2. **Moves off-chain:** All game actions (construction, mining, processing, trading, transit, etc.) — validated and executed locally, stored in MongoDB
3. **No forking:** Same codebase, behavior controlled by environment variables

---

## Table of Contents

- [Prerequisites](#prerequisites)
1. [Architecture Overview](#1-architecture-overview)
2. [Existing Simulation System (Client)](#2-existing-simulation-system-client)
3. [Phase 1: Configuration & Mode Switching](#3-phase-1-configuration--mode-switching)
4. [Phase 2: Selective Event Pipeline](#4-phase-2-selective-event-pipeline)
5. [Phase 3: Game Action API Endpoints](#5-phase-3-game-action-api-endpoints)
6. [Phase 4: Game Logic Engine](#6-phase-4-game-logic-engine)
7. [Phase 5: Client Integration](#7-phase-5-client-integration)
8. [Phase 6: Login & Ownership Sync](#8-phase-6-login--ownership-sync)
9. [Phase 7: Time & Tick System](#9-phase-7-time--tick-system)
10. [Phase 8: Testing](#10-phase-8-testing)
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
│   └── bootstrap.js           # Startup ownership data check
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

The client needs to route game action submissions to the server API instead of Starknet when in hybrid mode. The existing simulation system shows exactly how to intercept — we follow the same pattern but POST to the server instead of updating local Zustand state.

### 7.2 New Client Config

**File: `influence-client/src/appConfig/`** — Add to config:
```json
{
  "GameMode": "chain"   // "chain" or "hybrid"
}
```

Environment variable override: `REACT_APP_GAME_MODE=hybrid`

### 7.3 Modify ChainTransactionContext

**File: `influence-client/src/contexts/ChainTransactionContext.js`**

The `executeSystem` callback (line ~1166) already branches for simulation. Add a third branch for hybrid mode:

```js
const executeSystem = useCallback(async (key, vars, meta = {}) => {
  if (simulationEnabled) {
    // ... existing simulation logic (tutorial mode)
  }
  
  if (gameMode === 'hybrid') {
    // Submit to local server API instead of Starknet
    const response = await api.post('/v2/actions/' + key, {
      callerCrew: crew,
      vars,
      meta
    });
    
    // Create a pseudo pending transaction with the server's response
    const txHash = response.data.txHash || `0xlocal_${Date.now()}`;
    dispatchPendingTransaction({ key, vars, meta, txHash });
    
    // The server emits Socket.IO events which will trigger
    // ActivitiesContext to invalidate React Query caches
    // (same flow as chain mode, just faster)
    return;
  }
  
  // ... existing Starknet transaction flow
});
```

### 7.4 What Stays the Same on the Client

- **Entity queries** — unchanged, still hit `/v2/entities`, Elasticsearch
- **Socket.IO** — unchanged, server still emits events
- **Activity feed** — unchanged, server still creates Activity records
- **React Query cache invalidation** — unchanged, driven by Socket.IO events from server
- **NFT images/metadata** — unchanged
- **Auth flow** — unchanged (wallet connection + JWT)
- **Search** — unchanged (Elasticsearch)

### 7.5 What Changes on the Client

1. `ChainTransactionContext.js` — hybrid branch in `executeSystem`
2. Disable gas estimation / paymaster / token approval flows in hybrid mode (not needed)
3. Remove "waiting for transaction" polling (server responds synchronously)
4. Time-gated actions (construction, extraction, processing) may need a "fast forward" or "complete now" mechanism since there's no on-chain block progression

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

### 8.3 Initial Bootstrap: Historical Event Catch-Up

On first boot of a hybrid server, the MongoDB has no ownership data. The retriever
needs to catch up on all historical Transfer events from the chain.

The existing retriever already supports this via the `--run-once --fromBlock` flags:

```bash
# First boot: retrieve all historical asteroid + crewmate events
node src/workers/eventRetriever.js \
  --eventSource starknet \
  --run-once \
  --fromBlock 0

# Then run the processor to apply them
node src/workers/eventProcessor.js --ts 0
```

After the initial catch-up, the retriever runs in its normal polling loop and
picks up new Transfer events as they occur.

**File: `src/common/gameLogic/helpers/bootstrap.js`** (optional convenience wrapper)

```js
const { NftComponentService } = require('@common/services');
const logger = require('@common/lib/logger');

/**
 * Check if initial ownership data exists. If not, log a warning
 * directing the operator to run the initial retriever catch-up.
 * Called on server startup in hybrid mode.
 */
async function checkOwnershipBootstrap() {
  const NftComponent = mongoose.model('NftComponent');
  const asteroidCount = await NftComponent.countDocuments({ 'entity.label': Entity.IDS.ASTEROID });
  const crewmateCount = await NftComponent.countDocuments({ 'entity.label': Entity.IDS.CREWMATE });

  if (asteroidCount === 0 && crewmateCount === 0) {
    logger.warn(
      'No NFT ownership data found. Run the initial event catch-up:\n'
      + '  node src/workers/eventRetriever.js --eventSource starknet --run-once --fromBlock 0\n'
      + '  node src/workers/eventProcessor.js --ts 0'
    );
  } else {
    logger.info(`Ownership bootstrap OK: ${asteroidCount} asteroids, ${crewmateCount} crewmates`);
  }
}

module.exports = { checkOwnershipBootstrap };
```

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

## 10. Phase 8: Testing

### 10.1 Strategy

The existing test suite uses `mongodb-memory-server` and Mocha/Chai/Sinon. New tests follow the same patterns.

### 10.2 New Test Files

```
test/src/common/gameLogic/
├── GameEngine.spec.js
├── validators/
│   ├── access.spec.js
│   ├── crew.spec.js
│   ├── inventory.spec.js
│   └── location.spec.js
├── handlers/
│   ├── construction/
│   │   ├── plan.spec.js
│   │   ├── start.spec.js
│   │   └── finish.spec.js
│   ├── production/
│   │   ├── extractStart.spec.js
│   │   └── extractFinish.spec.js
│   └── ...
└── helpers/
    └── idGenerator.spec.js
```

### 10.3 Test Approach

Each handler test should:
1. Set up entities in mongodb-memory-server (use existing test factories)
2. Call the handler's `validate()` + `execute()`
3. Assert MongoDB state was updated correctly
4. Assert Activity record was created
5. Assert IndexItem was queued
6. Test validation failures (wrong owner, insufficient resources, wrong state, etc.)

### 10.4 Integration Tests

Add API-level tests for the `/v2/actions/:action` endpoint:
```
test/src/api/controllers/actions.spec.js
```

These use `supertest` (already a devDependency) to test the full request cycle.

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
| `src/common/gameLogic/helpers/bootstrap.js` | Startup check for ownership data (warns if initial catch-up needed) |
| `src/common/storage/db/models/Counter.js` | ID counter model |
| `src/api/controllers/actions.js` | Action API endpoints |
| `test/src/common/gameLogic/**/*.spec.js` | Tests |

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
| `src/common/storage/db/models/index.js` | Register Counter model |

### Client Changes (influence-client)

| File | Change |
|------|--------|
| `src/appConfig/_default.json` | Add `GameMode` config key |
| `src/contexts/ChainTransactionContext.js` | Add hybrid branch in `executeSystem` |
| `src/hooks/useSimulationEnabled.js` | Possibly extend for hybrid awareness |

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
  ├── ChainTransactionContext hybrid branch
  ├── Config additions
  └── Depends on: Phase 3 (can start in parallel with Phase 4)

Phase 6: Login & Ownership Sync (2-3 days)
  ├── bootstrap.js (startup ownership data check)
  ├── Initial event catch-up via existing retriever (--run-once --fromBlock 0)
  └── Depends on: Phase 1, Phase 2

Phase 7: Time System (1 day)
  ├── Player-triggered completion (Option A) — mostly free, just server-side timestamp check
  └── Depends on: Phase 4

Phase 8: Testing (ongoing, parallel with Phase 4)
  ├── Test each handler as it's built
  └── Integration tests after Phase 3 + 4
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

1. **Initial world state** — When a player connects to a fresh hybrid server, what asteroids exist? Use `seedData.js` to populate the asteroid belt, or sync all asteroid entities from chain on first boot?

2. **Crew creation** — On-chain, crews are NFTs that must be minted. In hybrid mode, should crew creation be free and local? Or tied to the on-chain Crewmate NFTs the user owns?

3. **SWAY token economy** — Should the local server simulate SWAY balances? The client's `MockTransactionManager` gives users a starting balance (`50e6 * TOKEN_SCALE`). The hybrid server would need a similar mechanism.

4. **Multi-server state** — If two hybrid servers run independently, they'll have divergent game states. Is this expected (each server is its own "world")? Or should there be a sync mechanism?

5. **Read-only chain data** — Some data the client reads directly from Starknet RPC (e.g., SWAY balance via `useWalletTokenBalance`). In hybrid mode, should the client read these from the local server instead?

6. **Session keys** — The client uses Starknet session keys for gas-free transactions. In hybrid mode, these aren't needed (no gas). The client should skip session key setup.
