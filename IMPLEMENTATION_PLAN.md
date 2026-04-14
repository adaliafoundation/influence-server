# Implementation Plan: Hybrid Local Game Mode

## Goal

Add a `GAME_MODE=hybrid` option to the influence-server that:

1. **Keeps on-chain:** Starknet wallet authentication + Asteroid and Crewmate NFT ownership tracking
2. **Moves off-chain:** All game actions (construction, mining, processing, trading, transit, etc.) — validated and executed locally, stored in MongoDB
3. **No forking:** Same codebase, behavior controlled by environment variables

---

## Table of Contents

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

---

## 4. Phase 2: Selective Event Pipeline

### 4.1 Event Retriever — Filter by Contract

In hybrid mode, the Starknet event retriever should only poll events from Asteroid and Crewmate NFT contracts (Transfer events for ownership tracking). All Dispatcher events (game actions) are skipped.

**File: `src/common/lib/events/retrievers/starknet/retriever.js`**

Modify the retriever to accept a contract filter. In hybrid mode, only query events from:
- `Contracts.starknet.asteroid` — Asteroid NFT transfers
- `Contracts.starknet.crewmate` — Crewmate NFT transfers

The retriever already queries events by contract address, so this is a configuration-level filter.

**File: `src/common/lib/events/processor/EventProcessor.js`**

Add a guard in `process()`:
```js
async process({ events }) {
  return eachSeries(events, async (event) => {
    // In hybrid mode, only process ownership-related events
    if (isHybrid() && !this.isOwnershipEvent(event)) {
      // Mark as processed but skip handler execution
      event.set('lastProcessed', new Date());
      await event.save();
      return;
    }
    // ... existing processing logic
  });
}

isOwnershipEvent(event) {
  const ownershipEvents = ['Transfer', 'BridgedFromL1', 'BridgedToL1'];
  const syncContracts = getSyncContracts();
  // Check if event comes from a synced contract AND is an ownership event
  return syncContracts.some(c => event.address === appConfig.get(`Contracts.starknet.${c}`))
    && ownershipEvents.includes(event.event);
}
```

### 4.2 Workers — Conditional Startup

**Files: `src/workers/eventRetriever.js`, `src/workers/eventProcessor.js`**

Add early exit for workers that shouldn't run in hybrid mode:

```js
// In eventRetriever.js — Ethereum retriever is fully disabled in hybrid
if (isHybrid() && args.eventSource === 'ethereum') {
  logger.info('Ethereum retriever disabled in hybrid mode');
  process.exit(0);
}
```

The Starknet retriever still runs but with the contract filter from 4.1.

**Workers status by mode:**

| Worker | Chain Mode | Hybrid Mode |
|--------|-----------|-------------|
| `eventRetriever` (ethereum) | runs | **disabled** |
| `eventRetriever` (starknet) | runs | runs (filtered to asteroid + crewmate contracts only) |
| `eventProcessor` | runs | runs (filters to ownership events only) |
| `elasticsearch` | runs | runs |
| `nftCardBuilder` | runs | runs |
| `starknetEventAuditor` | runs | **disabled** |
| `notifications` | runs | runs |

### 4.3 Procfile / ecosystem.config.js Updates

No changes needed — disabled workers exit cleanly on startup.

---

## 5. Phase 3: Game Action API Endpoints

### 5.1 New Action Controller

**New file: `src/api/controllers/actions.js`**

This controller accepts game action requests and routes them to the game logic engine. It only mounts in hybrid mode.

```js
// POST /v2/actions/:action
// Body: { callerCrew: { id, label }, vars: { ... }, meta: { ... } }
// Auth: JWT required (wallet address extracted from token)

const executeAction = async (ctx) => {
  const { params: { action }, request: { body }, state: { user: { sub: address } } } = ctx;
  
  try {
    const result = await GameEngine.execute({
      action,
      address,
      callerCrew: body.callerCrew,
      vars: body.vars,
      meta: body.meta
    });
    
    ctx.status = 200;
    ctx.body = result;
  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: error.message };
  }
};
```

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
| `ResupplyFood` | `crew/resupply_food.cairo` | Consumes Food from Inventory, updates Crew.lastFed |

**Priority 2 — Trading & Marketplace:**
| Action | State Changes |
|--------|---------------|
| `CreateSellOrder` | Creates Order entity, moves product from Inventory to escrow |
| `CreateBuyOrder` | Creates Order entity, reserves SWAY |
| `FillSellOrder` | Transfers product to buyer Inventory, transfers SWAY to seller |
| `FillBuyOrder` | Transfers product to buyer, releases SWAY |
| `CancelSellOrder` | Returns product to Inventory, removes Order |
| `CancelBuyOrder` | Returns SWAY, removes Order |
| `ConfigureExchange` | Updates Exchange component (fees, allowed products) |

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

**Priority 5 — Agreements, Policies, Misc:**
| Action | State Changes |
|--------|---------------|
| `AcceptContractAgreement` | Creates ContractAgreement |
| `CancelPrepaidAgreement` | Removes PrepaidAgreement |
| `ExtendPrepaidAgreement` | Updates PrepaidAgreement.endTime |
| `AssignPublicPolicy` / `RemovePublicPolicy` | Updates PublicPolicy component |
| `AssignPrepaidPolicy` / `RemovePrepaidPolicy` | Updates PrepaidPolicy component |
| `AddToWhitelist` / `RemoveFromWhitelist` | Updates WhitelistAgreement |
| `ChangeName` | Updates Name component |
| `ConstructionDeconstruct` | Returns materials (with penalty), Building → removed |
| `ConstructionAbandon` | Removes planned Building |
| `ManageAsteroid` | Updates asteroid permissions |
| `AnnotateEvent` | Creates EventAnnotation |
| `DirectMessage` | Creates DirectMessage |

### 5.3 Mount in Server

**File: `src/api/server.js`** — Conditionally mount actions controller:
```js
if (isHybrid()) {
  server.use(controllers.actions.routes());
}
```

**File: `src/api/controllers/index.js`** — Add:
```js
const actions = require('./actions');
// ... in module.exports:
actions,
```

---

## 6. Phase 4: Game Logic Engine

This is the core new code. It validates and executes game actions locally, replacing the Starknet contracts.

### 6.1 Directory Structure

```
src/common/gameLogic/
├── GameEngine.js              # Main entry point — routes actions to handlers
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
│   │   └── resupplyFood.js
│   ├── deposits/
│   │   ├── sampleStart.js
│   │   ├── sampleFinish.js
│   │   └── sampleImprove.js
│   ├── orders/
│   │   ├── createSellOrder.js
│   │   ├── createBuyOrder.js
│   │   ├── fillSellOrder.js
│   │   ├── fillBuyOrder.js
│   │   ├── cancelSellOrder.js
│   │   └── cancelBuyOrder.js
│   ├── ship/
│   │   ├── dock.js
│   │   ├── undock.js
│   │   ├── transitStart.js
│   │   └── transitFinish.js
│   ├── deliveries/
│   │   ├── send.js
│   │   ├── receive.js
│   │   ├── cancel.js
│   │   └── package.js
│   ├── agreements/
│   │   ├── acceptPrepaid.js
│   │   ├── cancelPrepaid.js
│   │   ├── extendPrepaid.js
│   │   └── acceptContract.js
│   ├── policies/
│   │   ├── assignPublic.js
│   │   ├── removePublic.js
│   │   ├── assignPrepaid.js
│   │   └── removePrepaid.js
│   └── misc/
│       ├── changeName.js
│       ├── manageAsteroid.js
│       ├── configureExchange.js
│       └── annotateEvent.js
└── helpers/
    ├── idGenerator.js         # Generates unique entity IDs (replaces on-chain ID assignment)
    ├── timeAcceleration.js    # Game time calculations (uses @influenceth/sdk Time)
    └── modifiers.js           # Crew/building efficiency modifiers
```

### 6.2 GameEngine.js — Main Router

```js
class GameEngine {
  static handlers = {
    'ConstructionPlan': require('./handlers/construction/plan'),
    'ConstructionStart': require('./handlers/construction/start'),
    'ConstructionFinish': require('./handlers/construction/finish'),
    // ... all other actions
  };

  static async execute({ action, address, callerCrew, vars, meta }) {
    const HandlerClass = this.handlers[action];
    if (!HandlerClass) throw new Error(`Unknown action: ${action}`);
    
    const handler = new HandlerClass({ action, address, callerCrew, vars, meta });
    
    // 1. Validate
    await handler.validate();
    
    // 2. Execute (write to MongoDB)
    const result = await handler.execute();
    
    // 3. Create activity record
    await handler.createActivity();
    
    // 4. Queue for Elasticsearch indexing
    await handler.queueIndexing();
    
    // 5. Emit Socket.IO events
    await handler.emitEvents();
    
    return result;
  }
}
```

### 6.3 BaseActionHandler.js

```js
class BaseActionHandler {
  constructor({ action, address, callerCrew, vars, meta }) {
    this.action = action;
    this.address = address;
    this.callerCrew = callerCrew;
    this.vars = vars;
    this.meta = meta;
    this.modifiedEntities = [];  // Track what changed for indexing
    this.socketMessages = [];    // Track what to emit
  }

  // Override in subclasses
  async validate() { throw new Error('Must implement validate()'); }
  async execute() { throw new Error('Must implement execute()'); }

  // Common: create an Activity record (same format as event handlers produce)
  async createActivity() {
    const ActivityModel = mongoose.model('Activity');
    const activity = new ActivityModel({
      event: {
        event: this.getEventName(),
        name: this.getEventName(),
        transactionHash: this.generateLocalTxHash(),
        timestamp: Math.floor(Date.now() / 1000),
        returnValues: this.getReturnValues()
      },
      entities: this.modifiedEntities.map(e => ({ id: e.id, label: e.label, uuid: Entity.packEntity(e) })),
      // ...
    });
    await activity.save();
  }

  // Common: queue changed entities for ES indexing
  async queueIndexing() {
    const IndexItem = mongoose.model('IndexItem');
    for (const entity of this.modifiedEntities) {
      await IndexItem.create({
        entityId: entity.id,
        entityLabel: entity.label,
        priority: 1
      });
    }
  }

  // Common: emit Socket.IO events to relevant rooms
  async emitEvents() {
    const eventEmitter = require('@common/lib/sio/emitter');
    for (const msg of this.socketMessages) {
      await eventEmitter.emitTo(msg);
    }
  }

  generateLocalTxHash() {
    return `0xlocal_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
}
```

### 6.4 Example Handler: Construction Plan

**Reference:** `influence-starknet/src/systems/construction/plan.cairo`

```js
// src/common/gameLogic/handlers/construction/plan.js
const { Building, Entity, Lot } = require('@influenceth/sdk');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { EntityService, ComponentService } = require('@common/services');

class ConstructionPlanHandler extends BaseActionHandler {
  getEventName() { return 'ConstructionPlanned'; }

  async validate() {
    const { lot, building_type, caller_crew } = this.vars;
    
    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({ 
      id: caller_crew.id, label: Entity.IDS.CREW, 
      components: ['Crew', 'Location', 'Control'] 
    });
    if (!this.crew) throw new Error('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);
    
    // 2. Crew must be ready (not busy)
    CrewValidator.assertReady(this.crew);
    
    // 3. Lot must exist and be on an asteroid
    this.lot = await EntityService.getEntity({ 
      id: lot.id, label: Entity.IDS.LOT, 
      components: ['Location'] 
    });
    if (!this.lot) throw new Error('Lot not found');
    
    // 4. Lot must not already have a building
    const existingBuildings = await EntityService.getEntities({ 
      label: Entity.IDS.BUILDING, 
      match: { 'Location.location.id': lot.id, 'Location.location.label': Entity.IDS.LOT } 
    });
    if (existingBuildings.length > 0) throw new Error('Lot already has a building');
    
    // 5. Must have USE_LOT permission
    await AccessValidator.assertPermission(this.crew, this.lot, Permission.IDS.USE_LOT);
    
    // 6. Building type must be valid
    if (!Building.TYPES[building_type]) throw new Error('Invalid building type');
  }

  async execute() {
    const { lot, building_type, caller_crew } = this.vars;
    const newId = await IdGenerator.next(Entity.IDS.BUILDING);
    
    // Create building entity with components
    const building = await EntityService.createEntity({
      id: newId,
      label: Entity.IDS.BUILDING,
      components: {
        Building: { 
          buildingType: building_type, 
          status: Building.CONSTRUCTION_STATUSES.PLANNED,
          plannedAt: Math.floor(Date.now() / 1000)
        },
        Control: { controller: { id: caller_crew.id, label: Entity.IDS.CREW } },
        Location: { 
          location: { id: lot.id, label: Entity.IDS.LOT },
          locations: [
            { id: lot.id, label: Entity.IDS.LOT },
            this.lot.Location.locations[0]  // asteroid
          ]
        },
        Name: { name: '' }
      }
    });

    this.modifiedEntities.push(
      { id: newId, label: Entity.IDS.BUILDING },
      { id: lot.id, label: Entity.IDS.LOT }
    );
    
    // Emit to asteroid room
    const asteroidId = Lot.toPosition(lot.id).asteroidId;
    this.socketMessages.push({
      room: `Asteroid::${asteroidId}`,
      type: 'ConstructionPlanned',
      eventName: 'ConstructionPlanned',
      body: { event: { event: 'ConstructionPlanned', returnValues: this.getReturnValues() } }
    });

    return { buildingId: newId };
  }

  getReturnValues() {
    return {
      callerCrew: this.vars.caller_crew,
      lot: this.vars.lot,
      buildingType: this.vars.building_type,
      caller: this.address
    };
  }
}
```

### 6.5 Validator Modules

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
- `addProduct(entityId, slot, product, amount)` — adds to inventory contents
- `removeProduct(entityId, slot, product, amount)` — removes from inventory contents

**`validators/location.js`**:
- `assertSameLocation(entityA, entityB)` — checks entities are on the same lot/asteroid
- `assertOnAsteroid(entity, asteroidId)` — checks entity is on specific asteroid

**`validators/stateMachine.js`**:
- `assertStatus(component, expectedStatus)` — e.g., Extractor must be IDLE to start
- `assertFinished(component)` — e.g., `finishTime <= now` for time-gated completions

### 6.6 ID Generation

On-chain, entity IDs are assigned by the contract. Locally, we need a thread-safe incrementing ID generator.

**`helpers/idGenerator.js`**:
```js
// Uses a MongoDB counter collection to generate unique IDs per entity type
// Starts at a high offset (e.g., 100,000,000) to avoid colliding with on-chain IDs
class IdGenerator {
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

### 8.2 Ownership Sync on Login

When a user logs into a hybrid server, we need to ensure their asteroid and crewmate ownership is current in MongoDB.

**New file: `src/common/gameLogic/ownershipSync.js`**

```js
// Called after successful authentication
async function syncOwnership(address) {
  const provider = new StarknetProvider();
  
  // Query Asteroid NFT contract for tokens owned by this address
  const asteroidContract = appConfig.get('Contracts.starknet.asteroid');
  const asteroids = await provider.getTokensOwnedBy(asteroidContract, address);
  
  // Query Crewmate NFT contract for tokens owned by this address
  const crewmateContract = appConfig.get('Contracts.starknet.crewmate');
  const crewmates = await provider.getTokensOwnedBy(crewmateContract, address);
  
  // Update Nft components in MongoDB
  for (const asteroidId of asteroids) {
    await ComponentService.upsert({
      entityId: asteroidId,
      entityLabel: Entity.IDS.ASTEROID,
      component: 'Nft',
      data: { owners: { starknet: address }, owner: address, chain: 'STARKNET' }
    });
  }
  
  for (const crewmateId of crewmates) {
    await ComponentService.upsert({
      entityId: crewmateId,
      entityLabel: Entity.IDS.CREWMATE,
      component: 'Nft',
      data: { owners: { starknet: address }, owner: address, chain: 'STARKNET' }
    });
  }
  
  return { asteroids, crewmates };
}
```

### 8.3 Trigger Sync

**File: `src/api/controllers/auth.js`** — After JWT generation in `verifyAuthChallenge`:

```js
// In hybrid mode, sync NFT ownership from chain
if (isHybrid()) {
  // Fire and forget — don't block login on this
  syncOwnership(address).catch(err => logger.warn('Ownership sync failed:', err));
}
```

### 8.4 Background Ownership Updates

The Starknet event retriever (still running, filtered to asteroid + crewmate contracts) handles ongoing ownership changes:
- If a user trades an Asteroid NFT on a marketplace, the Transfer event updates MongoDB
- If a user bridges an NFT, the Bridge events update MongoDB

This ensures the local server stays in sync with on-chain ownership without manual intervention.

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
| `src/common/gameLogic/handlers/BaseActionHandler.js` | Base handler class |
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
| `src/common/gameLogic/ownershipSync.js` | On-login NFT ownership sync |
| `src/common/storage/db/models/Counter.js` | ID counter model |
| `src/api/controllers/actions.js` | Action API endpoints |
| `test/src/common/gameLogic/**/*.spec.js` | Tests |

### Modified Files

| File | Change |
|------|--------|
| `config/default.json` | Add `GameMode` section |
| `config/custom-environment-variables.json` | Map `GAME_MODE` env var |
| `src/api/server.js` | Conditionally mount actions controller |
| `src/api/controllers/index.js` | Export actions controller |
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
  ├── gameMode.js helper
  ├── config/default.json + custom-environment-variables.json
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
  ├── ownershipSync.js
  ├── Auth controller modifications
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

2. **Entity service write path** — The existing `EntityService` and `ComponentService` are designed primarily for reads and event-driven updates. Writing new entities/components from the action handlers may need new service methods or direct Mongoose model access. The existing event handlers in `src/common/lib/events/handlers/starknet/Dispatcher/` show the write patterns — follow those.

3. **Multiplayer consistency** — If multiple players share a hybrid server, concurrent game actions could cause race conditions (two crews trying to build on the same lot simultaneously). May need MongoDB transactions or optimistic locking for critical operations.

4. **SDK version alignment** — The server uses `@influenceth/sdk@2.2.0-beta.1` and the client uses `@influenceth/sdk@^2.3.8`. Ensure both use the same version for consistent game constants.

### Open Questions

1. **Initial world state** — When a player connects to a fresh hybrid server, what asteroids exist? Use `seedData.js` to populate the asteroid belt, or sync all asteroid entities from chain on first boot?

2. **Crew creation** — On-chain, crews are NFTs that must be minted. In hybrid mode, should crew creation be free and local? Or tied to the on-chain Crewmate NFTs the user owns?

3. **SWAY token economy** — Should the local server simulate SWAY balances? The client's `MockTransactionManager` gives users a starting balance (`50e6 * TOKEN_SCALE`). The hybrid server would need a similar mechanism.

4. **Multi-server state** — If two hybrid servers run independently, they'll have divergent game states. Is this expected (each server is its own "world")? Or should there be a sync mechanism?

5. **Read-only chain data** — Some data the client reads directly from Starknet RPC (e.g., SWAY balance via `useWalletTokenBalance`). In hybrid mode, should the client read these from the local server instead?

6. **Session keys** — The client uses Starknet session keys for gas-free transactions. In hybrid mode, these aren't needed (no gas). The client should skip session key setup.
