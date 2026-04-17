/**
 * Integration test helper for hybrid-mode action endpoints.
 *
 * Provides seed data loading, JWT generation, supertest wrapper,
 * and convenience constants matching the seed entities.
 */
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const appConfig = require('config');
const http = require('http');
const request = require('supertest');
const Koa = require('koa');
const { Address } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');

// ─── Wallet / Auth ─────────────────────────────────────────────────────────
const WALLET_ADDRESS = Address.toStandard('0x0669B0254bce827409e794EB6146d355Ed0dE3A7306ab8E4CDA9ed8C5A48b09d');
const WRONG_WALLET = Address.toStandard('0x0111111111111111111111111111111111111111111111111111111111111111');

function makeToken(address) {
  return jwt.sign({ sub: address }, appConfig.get('App.jwtSecret'));
}

const TOKEN = makeToken(WALLET_ADDRESS);
const WRONG_TOKEN = makeToken(WRONG_WALLET);

// ─── Entity constants (matching seed data.json) ────────────────────────────
const CREW_1 = { id: 1, label: 1 };
const CREW_2 = { id: 2, label: 1 };
const ASTEROID_1 = { id: 1, label: 3 };
const ASTEROID_2 = { id: 2, label: 3 };
const WAREHOUSE = { id: 1, label: 5 };
const EXTRACTOR = { id: 2, label: 5 };
const REFINERY = { id: 3, label: 5 };
const FACTORY = { id: 4, label: 5 };
const SHIPYARD = { id: 5, label: 5 };
const BIOREACTOR = { id: 6, label: 5 };
const MARKETPLACE_BLDG = { id: 7, label: 5 };
const HABITAT = { id: 8, label: 5 };
const SPACEPORT = { id: 9, label: 5 };
const TANK_FARM = { id: 10, label: 5 };
const SHIP_1 = { id: 1, label: 6 };

// Lot on asteroid 1 with no building (lotIndex 11)
// Lot id = (lotIndex << 32) | asteroidId = 11 * 2**32 + 1
const EMPTY_LOT = { id: (11 * 4294967296) + 1, label: 4 };

// ─── Seed data loader ──────────────────────────────────────────────────────

const SEED_DATA_PATH = path.resolve(__dirname, '../seed/data.json');

const COLLECTIONS_TO_CLEAR = [
  'Constant', 'Entity',
  'NftComponent', 'CelestialComponent', 'OrbitComponent', 'NameComponent',
  'CrewComponent', 'CrewmateComponent', 'LocationComponent', 'ControlComponent',
  'BuildingComponent', 'ShipComponent', 'InventoryComponent',
  'StationComponent', 'DockComponent', 'ExtractorComponent',
  'ProcessorComponent', 'DryDockComponent',
  'DepositComponent', 'DeliveryComponent',
  'OrderComponent', 'ExchangeComponent',
  'PublicPolicyComponent', 'WhitelistAgreementComponent',
  'PrepaidPolicyComponent', 'ContractPolicyComponent',
  'PrepaidAgreementComponent', 'ContractAgreementComponent',
  'PrivateSaleComponent',
  'User', 'WorldFork', 'Activity'
];

function replaceWallet(obj, address) {
  return JSON.parse(JSON.stringify(obj).replace(/"WALLET"/g, JSON.stringify(address)));
}

async function clearCollections() {
  for (const name of COLLECTIONS_TO_CLEAR) {
    try { await mongoose.model(name).deleteMany({}); } catch (_) { /* model may not exist */ }
  }
  // Raw collections
  const db = mongoose.connection.db;
  try { await db.collection('events').deleteMany({}); } catch (_) {}
  try { await db.collection('counters').deleteMany({}); } catch (_) {}
}

async function loadSeedData(walletAddress = WALLET_ADDRESS) {
  // Re-read each time so tests get fresh copy
  delete require.cache[SEED_DATA_PATH];
  const seedData = require(SEED_DATA_PATH); // eslint-disable-line global-require

  // 0. Constants
  for (const c of (seedData.constants || [])) {
    await mongoose.model('Constant').findOneAndUpdate({ name: c.name }, c, { upsert: true, new: true });
  }

  // 1. Entities
  for (const ent of seedData.entities) {
    const uuid = EntityLib.toUuid(ent.id, ent.label);
    await mongoose.model('Entity').updateOne({ uuid }, { $setOnInsert: { id: ent.id, label: ent.label, uuid } }, { upsert: true });
  }

  // 2. Nft
  const nfts = replaceWallet(seedData.nftComponents, walletAddress);
  for (const nft of nfts) {
    await mongoose.model('NftComponent').findOneAndUpdate(
      { 'entity.id': nft.entity.id, 'entity.label': nft.entity.label }, nft, { upsert: true, new: true }
    );
  }

  // 3. Celestial
  for (const c of seedData.celestialComponents) {
    await mongoose.model('CelestialComponent').findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label }, c, { upsert: true, new: true }
    );
  }

  // 4. Orbit
  for (const o of seedData.orbitComponents) {
    await mongoose.model('OrbitComponent').findOneAndUpdate(
      { 'entity.id': o.entity.id, 'entity.label': o.entity.label }, o, { upsert: true, new: true }
    );
  }

  // 5. Names
  for (const n of seedData.nameComponents) {
    await mongoose.model('NameComponent').findOneAndUpdate(
      { 'entity.id': n.entity.id, 'entity.label': n.entity.label }, n, { upsert: true, new: true }
    );
  }

  // 6. Crew
  const crews = replaceWallet(seedData.crewComponents, walletAddress);
  for (const c of crews) {
    await mongoose.model('CrewComponent').findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label }, c, { upsert: true, new: true }
    );
  }

  // 7. Crewmate
  for (const c of seedData.crewmateComponents) {
    await mongoose.model('CrewmateComponent').findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label }, c, { upsert: true, new: true }
    );
  }

  // 8. Location
  for (const l of seedData.locationComponents) {
    await mongoose.model('LocationComponent').findOneAndUpdate(
      { 'entity.id': l.entity.id, 'entity.label': l.entity.label },
      { entity: l.entity, location: l.location, locations: l.locations || [] },
      { upsert: true, new: true }
    );
  }

  // 9. Control
  for (const c of seedData.controlComponents) {
    await mongoose.model('ControlComponent').findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label }, c, { upsert: true, new: true }
    );
  }

  // 10. Building
  for (const b of seedData.buildingComponents) {
    await mongoose.model('BuildingComponent').findOneAndUpdate(
      { 'entity.id': b.entity.id, 'entity.label': b.entity.label }, b, { upsert: true, new: true }
    );
  }

  // 11. Ship
  for (const s of (seedData.shipComponents || [])) {
    await mongoose.model('ShipComponent').findOneAndUpdate(
      { 'entity.id': s.entity.id, 'entity.label': s.entity.label }, s, { upsert: true, new: true }
    );
  }

  // 12. Inventory
  for (const inv of seedData.inventoryComponents) {
    if (inv.contents && inv.contents.length > 0 && !inv.mass) {
      inv.mass = inv.contents.reduce((sum, c) => sum + (c.amount || 0), 0);
    }
    await mongoose.model('InventoryComponent').findOneAndUpdate(
      { 'entity.id': inv.entity.id, 'entity.label': inv.entity.label, slot: inv.slot },
      inv, { upsert: true, new: true }
    );
  }

  // 13. Station
  for (const s of seedData.stationComponents) {
    await mongoose.model('StationComponent').findOneAndUpdate(
      { 'entity.id': s.entity.id, 'entity.label': s.entity.label }, s, { upsert: true, new: true }
    );
  }

  // 14. Dock
  for (const d of (seedData.dockComponents || [])) {
    await mongoose.model('DockComponent').findOneAndUpdate(
      { 'entity.id': d.entity.id, 'entity.label': d.entity.label }, d, { upsert: true, new: true }
    );
  }

  // 14b. Exchange
  for (const ex of (seedData.exchangeComponents || [])) {
    await mongoose.model('ExchangeComponent').findOneAndUpdate(
      { 'entity.id': ex.entity.id, 'entity.label': ex.entity.label }, ex, { upsert: true, new: true }
    );
  }

  // 14c. Public policies
  for (const pp of (seedData.publicPolicyComponents || [])) {
    await mongoose.model('PublicPolicyComponent').findOneAndUpdate(
      { 'entity.id': pp.entity.id, 'entity.label': pp.entity.label, permission: pp.permission },
      pp, { upsert: true, new: true }
    );
  }

  // 15. Extractor
  for (const e of (seedData.extractorComponents || [])) {
    await mongoose.model('ExtractorComponent').findOneAndUpdate(
      { 'entity.id': e.entity.id, 'entity.label': e.entity.label, slot: e.slot }, e, { upsert: true, new: true }
    );
  }

  // 16. Processor
  for (const p of (seedData.processorComponents || [])) {
    await mongoose.model('ProcessorComponent').findOneAndUpdate(
      { 'entity.id': p.entity.id, 'entity.label': p.entity.label, slot: p.slot }, p, { upsert: true, new: true }
    );
  }

  // 17. DryDock
  for (const dd of (seedData.dryDockComponents || [])) {
    await mongoose.model('DryDockComponent').findOneAndUpdate(
      { 'entity.id': dd.entity.id, 'entity.label': dd.entity.label, slot: dd.slot }, dd, { upsert: true, new: true }
    );
  }

  // 18. User
  await mongoose.model('User').findOneAndUpdate(
    { address: walletAddress },
    { $setOnInsert: { address: walletAddress } },
    { upsert: true, new: true }
  );

  // 19. WorldFork
  const existingFork = await mongoose.model('WorldFork').findOne({});
  if (!existingFork) {
    await mongoose.model('WorldFork').create({
      blockNumber: 0, blockHash: '0x0', blockTimestamp: new Date(), forkedAt: new Date(), label: 'test-seed'
    });
  }
}

async function resetSeedData(walletAddress = WALLET_ADDRESS) {
  await clearCollections();
  await loadSeedData(walletAddress);
}

// ─── Stubs ─────────────────────────────────────────────────────────────────

/**
 * Apply all necessary stubs for the action tests.
 * Call in before() or beforeEach() — the caller's sandbox.restore() cleans up.
 */
function applyStubs(sandbox) {
  // Stub mongoose sessions (MongoMemoryServer has no replica set by default).
  // We create a fake session that GameEngine can call start/commit/abort on,
  // but that evaluates to falsy when used as `{ session }` option in Mongoose
  // operations (save, updateOne). The trick: BaseActionHandler stores
  // `this.session = session` and passes it as `{ session: this.session }`.
  // We intercept setSession so it stores null instead.
  const fakeSession = {
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
    inTransaction: () => false,
    hasEnded: false
  };
  sandbox.stub(mongoose, 'startSession').resolves(fakeSession);

  // Prevent the session from being passed to Mongoose operations.
  // BaseActionHandler.setSession stores the session — we override it to store null.
  const BaseActionHandler = require('@common/gameLogic/handlers/BaseActionHandler'); // eslint-disable-line global-require
  const origSetSession = BaseActionHandler.prototype.setSession;
  if (!origSetSession._stubbed) {
    sandbox.stub(BaseActionHandler.prototype, 'setSession').callsFake(function () {
      this.session = null;
    });
    BaseActionHandler.prototype.setSession._stubbed = true;
  }

  // Stub Socket.IO emitter (requires Redis)
  const emitter = require('@common/lib/sio/emitter'); // eslint-disable-line global-require
  if (!emitter.emitTo?.isSinonProxy) sandbox.stub(emitter, 'emitTo').resolves();
  if (!emitter.broadcast?.isSinonProxy) sandbox.stub(emitter, 'broadcast').resolves();

  // Stub ElasticSearch indexing
  const { ElasticSearchService } = require('@common/services'); // eslint-disable-line global-require
  if (ElasticSearchService?.queueEntityForIndexing && !ElasticSearchService.queueEntityForIndexing.isSinonProxy) {
    sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
  }
}

// ─── Server builder ────────────────────────────────────────────────────────

let _cachedServer = null;

function buildActionServer() {
  if (_cachedServer) return _cachedServer;

  const actionsRouter = require('@api/controllers/actions'); // eslint-disable-line global-require
  const usersRouter = require('@api/controllers/users'); // eslint-disable-line global-require
  const app = new Koa();
  app.use(actionsRouter.routes());
  app.use(actionsRouter.allowedMethods());
  app.use(usersRouter.routes());
  app.use(usersRouter.allowedMethods());

  const server = request(http.createServer(app.callback()));
  _cachedServer = server;
  return server;
}

// ─── POST convenience ──────────────────────────────────────────────────────

function postAction(server, token, actionName, vars, meta) {
  const body = { callerCrew: vars?.caller_crew, vars, meta };
  return server
    .post(`/v2/actions/${actionName}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// ─── State mutation helpers ────────────────────────────────────────────────

async function setBuildingStatus(buildingId, status, finishTime = 0) {
  await mongoose.model('BuildingComponent').updateOne(
    { 'entity.id': buildingId, 'entity.label': 5 },
    { $set: { status, finishTime } }
  );
}

async function setInventoryStatus(entityId, entityLabel, slot, status) {
  await mongoose.model('InventoryComponent').updateOne(
    { 'entity.id': entityId, 'entity.label': entityLabel, slot },
    { $set: { status } }
  );
}

async function setCrewBusy(crewId, readyAt) {
  await mongoose.model('CrewComponent').updateOne(
    { 'entity.id': crewId, 'entity.label': 1 },
    { $set: { readyAt } }
  );
}

async function createEmptyLot(asteroidId, lotIndex) {
  const lotId = (lotIndex * 4294967296) + asteroidId;
  const uuid = EntityLib.toUuid(lotId, 4);
  await mongoose.model('Entity').updateOne({ uuid }, { $setOnInsert: { id: lotId, label: 4, uuid } }, { upsert: true });
  const asteroidUuid = EntityLib.toUuid(asteroidId, 3);
  await mongoose.model('LocationComponent').findOneAndUpdate(
    { 'entity.id': lotId, 'entity.label': 4 },
    {
      entity: { id: lotId, label: 4 },
      location: { id: asteroidId, label: 3 },
      locations: [{ id: asteroidId, label: 3, uuid: asteroidUuid }]
    },
    { upsert: true, new: true }
  );
  return { id: lotId, label: 4 };
}

async function createUnscannedAsteroid(id) {
  const uuid = EntityLib.toUuid(id, 3);
  await mongoose.model('Entity').updateOne({ uuid }, { $setOnInsert: { id, label: 3, uuid } }, { upsert: true });
  await mongoose.model('NftComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 3 },
    { entity: { id, label: 3 }, nftType: 0, owners: { starknet: WALLET_ADDRESS } },
    { upsert: true, new: true }
  );
  await mongoose.model('CelestialComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 3 },
    {
      entity: { id, label: 3 },
      celestialType: 1, mass: 1000000000, radius: 200000,
      purchaseOrder: 0, scanStatus: 0, scanFinishTime: 0, bonuses: 0, abundances: ''
    },
    { upsert: true, new: true }
  );
  await mongoose.model('ControlComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 3 },
    { entity: { id, label: 3 }, controller: { id: 1, label: 1 } },
    { upsert: true, new: true }
  );
  return { id, label: 3 };
}

async function createSampledDeposit(id, { resource = 1, remainingYield = 5000, lotId, asteroidId = 1 } = {}) {
  const uuid = EntityLib.toUuid(id, 7); // 7 = DEPOSIT
  await mongoose.model('Entity').updateOne({ uuid }, { $setOnInsert: { id, label: 7, uuid } }, { upsert: true });

  await mongoose.model('DepositComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 7 },
    {
      entity: { id, label: 7 },
      resource,
      status: 2, // SAMPLED
      initialYield: remainingYield,
      remainingYield,
      yieldEff: 1,
      finishTime: 0
    },
    { upsert: true, new: true }
  );

  // Place deposit on a lot on the asteroid
  const depositLotId = lotId || ((20 * 4294967296) + asteroidId);
  const lotUuid = EntityLib.toUuid(depositLotId, 4);
  const asteroidUuid = EntityLib.toUuid(asteroidId, 3);
  await mongoose.model('LocationComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 7 },
    {
      entity: { id, label: 7 },
      location: { id: depositLotId, label: 4 },
      locations: [
        { id: depositLotId, label: 4, uuid: lotUuid },
        { id: asteroidId, label: 3, uuid: asteroidUuid }
      ]
    },
    { upsert: true, new: true }
  );

  return { id, label: 7 };
}

async function createDeliveryEntity(id, { status, origin, dest, contents, finishTime = 0, controllerCrew = CREW_1 } = {}) {
  const uuid = EntityLib.toUuid(id, 9); // 9 = DELIVERY
  await mongoose.model('Entity').updateOne({ uuid }, { $setOnInsert: { id, label: 9, uuid } }, { upsert: true });
  await mongoose.model('DeliveryComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 9 },
    {
      entity: { id, label: 9 },
      status,
      origin: origin || { id: WAREHOUSE.id, label: WAREHOUSE.label },
      originSlot: 1,
      dest: dest || { id: EXTRACTOR.id, label: EXTRACTOR.label },
      destSlot: 1,
      contents: contents || [{ product: 1, amount: 100 }],
      finishTime
    },
    { upsert: true, new: true }
  );
  await mongoose.model('ControlComponent').findOneAndUpdate(
    { 'entity.id': id, 'entity.label': 9 },
    { entity: { id, label: 9 }, controller: { id: controllerCrew.id, label: controllerCrew.label } },
    { upsert: true, new: true }
  );
  return { id, label: 9 };
}

async function createOrder(exchangeId, { crew, orderType, product, amount, price, storage, storageSlot = 1, status = 1 } = {}) {
  const crewEntity = crew || CREW_1;
  const storageEntity = storage || WAREHOUSE;
  await mongoose.model('OrderComponent').findOneAndUpdate(
    {
      'entity.id': exchangeId, 'entity.label': 5,
      'crew.id': crewEntity.id, 'crew.label': crewEntity.label,
      orderType, product, price,
      'storage.id': storageEntity.id, 'storage.label': storageEntity.label,
      storageSlot
    },
    {
      entity: { id: exchangeId, label: 5 },
      crew: { id: crewEntity.id, label: crewEntity.label },
      orderType,
      product: Number(product),
      amount: Number(amount),
      price: Number(price),
      storage: { id: storageEntity.id, label: storageEntity.label },
      storageSlot,
      status,
      validTime: 0,
      makerFee: 0
    },
    { upsert: true, new: true }
  );
}

async function createPrepaidPolicy(targetId, targetLabel, { permission, rate = 100, initialTerm = 86400, noticePeriod = 3600 } = {}) {
  const uuid = EntityLib.toUuid(targetId, targetLabel);
  await mongoose.model('PrepaidPolicyComponent').findOneAndUpdate(
    { 'entity.uuid': uuid, permission },
    {
      entity: { id: targetId, label: targetLabel, uuid },
      permission,
      rate,
      initialTerm,
      noticePeriod
    },
    { upsert: true, new: true }
  );
}

async function createContractPolicy(targetId, targetLabel, { permission, contract = '0x1234' } = {}) {
  const uuid = EntityLib.toUuid(targetId, targetLabel);
  await mongoose.model('ContractPolicyComponent').findOneAndUpdate(
    { 'entity.uuid': uuid, permission },
    {
      entity: { id: targetId, label: targetLabel, uuid },
      permission,
      address: contract
    },
    { upsert: true, new: true }
  );
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  // Auth
  WALLET_ADDRESS,
  WRONG_WALLET,
  TOKEN,
  WRONG_TOKEN,
  makeToken,

  // Entity refs
  CREW_1, CREW_2,
  ASTEROID_1, ASTEROID_2,
  WAREHOUSE, EXTRACTOR, REFINERY, FACTORY, SHIPYARD,
  BIOREACTOR, MARKETPLACE_BLDG, HABITAT, SPACEPORT, TANK_FARM,
  SHIP_1, EMPTY_LOT,

  // Seed
  loadSeedData,
  resetSeedData,
  clearCollections,

  // Server
  buildActionServer,
  postAction,

  // Stubs
  applyStubs,

  // Helpers
  setBuildingStatus,
  setInventoryStatus,
  setCrewBusy,
  createEmptyLot,
  createUnscannedAsteroid,
  createSampledDeposit,
  createDeliveryEntity,
  createOrder,
  createPrepaidPolicy,
  createContractPolicy
};
